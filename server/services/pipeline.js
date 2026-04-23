const pool = require('../db');

const ACK_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Logs a state transition. Call this inside every transaction
 * that changes an application's status.
 */
async function logTransition(client, { applicationId, jobId, fromStatus, toStatus, reason }) {
  await client.query(
    `INSERT INTO pipeline_logs (application_id, job_id, from_status, to_status, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [applicationId, jobId, fromStatus, toStatus, reason]
  );
}

/**
 * The heart of the system.
 *
 * Called whenever an active slot opens up (exit, decay, hire, reject).
 * Uses SELECT FOR UPDATE on the job row to serialize concurrent calls —
 * only one promotion can happen at a time per job.
 *
 * Must be called with an active pg client (inside a transaction).
 */
async function promoteNext(client, jobId) {
  // Lock the job row — any concurrent call for the same job blocks here
  // until this transaction commits or rolls back.
  const { rows: [job] } = await client.query(
    `SELECT id, active_capacity FROM jobs WHERE id = $1 FOR UPDATE`,
    [jobId]
  );

  if (!job) return;

  // Count currently active + pending_ack slots
  const { rows: [{ count }] } = await client.query(
    `SELECT COUNT(*) FROM applications
     WHERE job_id = $1 AND status IN ('active', 'pending_ack')`,
    [jobId]
  );

  const occupied = parseInt(count, 10);
  const available = job.active_capacity - occupied;

  if (available <= 0) return; // no slot to fill

  // Find the next waitlisted applicant (lowest position wins)
  const { rows: [next] } = await client.query(
    `SELECT id, status, waitlist_position FROM applications
     WHERE job_id = $1 AND status = 'waitlisted'
     ORDER BY waitlist_position ASC
     LIMIT 1`,
    [jobId]
  );

  if (!next) return; // waitlist is empty

  const now = new Date();
  const ackDeadline = new Date(now.getTime() + ACK_WINDOW_MS);

  await client.query(
    `UPDATE applications
     SET status = 'pending_ack',
         waitlist_position = NULL,
         promoted_at = $1,
         ack_deadline = $2,
         updated_at = $1
     WHERE id = $3`,
    [now, ackDeadline, next.id]
  );

  await logTransition(client, {
    applicationId: next.id,
    jobId,
    fromStatus: 'waitlisted',
    toStatus: 'pending_ack',
    reason: 'Promoted from waitlist — awaiting acknowledgement',
  });
}

/**
 * Submit a new application.
 *
 * Concurrency case: two applications arrive simultaneously for the last slot.
 * Both enter this function. The first to acquire the FOR UPDATE lock gets
 * evaluated against current active count and may go active/pending_ack.
 * The second evaluates after the first commits — the slot is now full —
 * and goes to waitlist. No race condition, no double-booking.
 *
 * Waitlist position = MAX(existing positions) + 1, computed inside the lock.
 */
async function submitApplication(jobId, applicantName, applicantEmail) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock job row for the duration of this transaction
    const { rows: [job] } = await client.query(
      `SELECT id, active_capacity, status FROM jobs WHERE id = $1 FOR UPDATE`,
      [jobId]
    );

    if (!job) throw new Error('Job not found');
    if (job.status !== 'open') throw new Error('Job is not accepting applications');

    // How many active slots are taken?
    const { rows: [{ count }] } = await client.query(
      `SELECT COUNT(*) FROM applications
       WHERE job_id = $1 AND status IN ('active', 'pending_ack')`,
      [jobId]
    );
    const occupied = parseInt(count, 10);
    const hasSlot = occupied < job.active_capacity;

    let initialStatus, waitlistPosition;

    if (hasSlot) {
      // Goes straight to pending_ack — they still need to acknowledge
      initialStatus = 'pending_ack';
      waitlistPosition = null;
    } else {
      // Goes to waitlist — compute next position
      const { rows: [{ max_pos }] } = await client.query(
        `SELECT COALESCE(MAX(waitlist_position), 0) AS max_pos
         FROM applications
         WHERE job_id = $1 AND status = 'waitlisted'`,
        [jobId]
      );
      initialStatus = 'waitlisted';
      waitlistPosition = max_pos + 1;
    }

    const now = new Date();
    const ackDeadline = hasSlot ? new Date(now.getTime() + ACK_WINDOW_MS) : null;

    const { rows: [app] } = await client.query(
      `INSERT INTO applications
         (job_id, applicant_name, applicant_email, status,
          waitlist_position, promoted_at, ack_deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [jobId, applicantName, applicantEmail, initialStatus,
       waitlistPosition, hasSlot ? now : null, ackDeadline]
    );

    await logTransition(client, {
      applicationId: app.id,
      jobId,
      fromStatus: null,
      toStatus: initialStatus,
      reason: hasSlot ? 'Applied — slot available' : 'Applied — added to waitlist',
    });

    await client.query('COMMIT');
    return app;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Applicant acknowledges their promotion.
 * Moves them from pending_ack → active.
 */
async function acknowledgePromotion(applicationId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [app] } = await client.query(
      `SELECT id, job_id, status, ack_deadline FROM applications
       WHERE id = $1 FOR UPDATE`,
      [applicationId]
    );

    if (!app) throw new Error('Application not found');
    if (app.status !== 'pending_ack') throw new Error('Not awaiting acknowledgement');
    if (new Date() > new Date(app.ack_deadline)) throw new Error('Acknowledgement window expired');

    await client.query(
      `UPDATE applications SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [applicationId]
    );

    await logTransition(client, {
      applicationId,
      jobId: app.job_id,
      fromStatus: 'pending_ack',
      toStatus: 'active',
      reason: 'Applicant acknowledged promotion',
    });

    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Exit an active applicant (withdraw, reject, hire).
 * Promotes the next waitlisted applicant automatically.
 */
async function exitApplication(applicationId, reason, toStatus) {
  const VALID_EXIT = ['withdrawn', 'rejected', 'hired'];
  if (!VALID_EXIT.includes(toStatus)) throw new Error('Invalid exit status');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [app] } = await client.query(
      `SELECT id, job_id, status FROM applications WHERE id = $1 FOR UPDATE`,
      [applicationId]
    );

    if (!app) throw new Error('Application not found');
    if (!['active', 'pending_ack'].includes(app.status)) {
      throw new Error('Can only exit active or pending_ack applications');
    }

    await client.query(
      `UPDATE applications SET status = $1, updated_at = NOW() WHERE id = $2`,
      [toStatus, applicationId]
    );

    await logTransition(client, {
      applicationId,
      jobId: app.job_id,
      fromStatus: app.status,
      toStatus,
      reason,
    });

    // Slot freed — promote the next person
    await promoteNext(client, app.job_id);

    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { submitApplication, acknowledgePromotion, exitApplication, promoteNext };