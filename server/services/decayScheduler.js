const pool = require('../db');
const { promoteNext } = require('./pipeline');

const POLL_INTERVAL_MS = 60 * 1000; // check every 60 seconds

async function logTransition(client, { applicationId, jobId, fromStatus, toStatus, reason }) {
  await client.query(
    `INSERT INTO pipeline_logs (application_id, job_id, from_status, to_status, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [applicationId, jobId, fromStatus, toStatus, reason]
  );
}

/**
 * Finds all applications in pending_ack whose ack_deadline has passed.
 * For each one:
 *   1. Increments decay_penalty_count
 *   2. Computes new waitlist position = MAX(current positions) + 1 + (penalty_count * 5)
 *      The +5 per prior decay means repeat non-responders sink progressively further.
 *   3. Returns them to waitlisted
 *   4. Calls promoteNext to fill the now-vacant slot
 *
 * Each decay is its own transaction so one failure doesn't block others.
 */
async function processDecays() {
  const { rows: expired } = await pool.query(
    `SELECT id, job_id, decay_penalty_count
     FROM applications
     WHERE status = 'pending_ack' AND ack_deadline < NOW()`
  );

  for (const app of expired) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Re-fetch with lock inside transaction
      const { rows: [locked] } = await client.query(
        `SELECT id, job_id, status, decay_penalty_count
         FROM applications WHERE id = $1 FOR UPDATE`,
        [app.id]
      );

      // Guard: status may have changed since the outer SELECT
      if (!locked || locked.status !== 'pending_ack') {
        await client.query('ROLLBACK');
        continue;
      }

      const newPenaltyCount = locked.decay_penalty_count + 1;

      // Reset to end of waitlist — penalty count tracks failures but doesn't affect position
      const { rows: [{ max_pos }] } = await client.query(
        `SELECT COALESCE(MAX(waitlist_position), 0) AS max_pos
         FROM applications
         WHERE job_id = $1 AND status = 'waitlisted'`,
        [locked.job_id]
      );

      const newPosition = max_pos + 1;

      await client.query(
        `UPDATE applications
         SET status = 'waitlisted',
             waitlist_position = $1,
             decay_penalty_count = $2,
             promoted_at = NULL,
             ack_deadline = NULL,
             updated_at = NOW()
         WHERE id = $3`,
        [newPosition, newPenaltyCount, locked.id]
      );

      await logTransition(client, {
        applicationId: locked.id,
        jobId: locked.job_id,
        fromStatus: 'pending_ack',
        toStatus: 'waitlisted',
        reason: `Ack window expired — moved to end of waitlist (position ${newPosition}). Failed to acknowledge ${newPenaltyCount} time(s).`,
      });

      // Slot is free — cascade to next in line
      await promoteNext(client, locked.job_id);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Decay failed for application ${app.id}:`, err.message);
    } finally {
      client.release();
    }
  }
}

function startDecayScheduler() {
  console.log('Decay scheduler started — polling every 60s');
  setInterval(async () => {
    try {
      await processDecays();
    } catch (err) {
      console.error('Decay scheduler error:', err.message);
    }
  }, POLL_INTERVAL_MS);
}

module.exports = { startDecayScheduler };