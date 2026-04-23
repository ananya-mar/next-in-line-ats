const express = require('express');
const router = express.Router();
const pool = require('../db');

// POST /api/jobs — create a job opening
router.post('/', async (req, res) => {
  const { title, company_name, active_capacity } = req.body;
  if (!title || !company_name || !active_capacity) {
    return res.status(400).json({ error: 'title, company_name, active_capacity required' });
  }
  if (!Number.isInteger(active_capacity) || active_capacity < 1) {
    return res.status(400).json({ error: 'active_capacity must be a positive integer' });
  }
  try {
    const { rows: [job] } = await pool.query(
      `INSERT INTO jobs (title, company_name, active_capacity)
       VALUES ($1, $2, $3) RETURNING *`,
      [title, company_name, active_capacity]
    );
    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id/pipeline — full pipeline state for the dashboard
router.get('/:id/pipeline', async (req, res) => {
  try {
    const { rows: [job] } = await pool.query(
      `SELECT * FROM jobs WHERE id = $1`, [req.params.id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { rows: applications } = await pool.query(
      `SELECT id, applicant_name, applicant_email, status,
              waitlist_position, decay_penalty_count, ack_deadline, created_at
       FROM applications
       WHERE job_id = $1
       ORDER BY
         CASE status
           WHEN 'active'      THEN 1
           WHEN 'pending_ack' THEN 2
           WHEN 'waitlisted'  THEN 3
           ELSE 4
         END,
         waitlist_position ASC NULLS LAST,
         created_at ASC`,
      [req.params.id]
    );

    res.json({ job, applications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id/logs — full audit trail
router.get('/:id/logs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pl.*, a.applicant_name, a.applicant_email
       FROM pipeline_logs pl
       JOIN applications a ON a.id = pl.application_id
       WHERE pl.job_id = $1
       ORDER BY pl.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;