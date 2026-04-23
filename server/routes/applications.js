const express = require('express');
const router = express.Router();
const pool = require('../db');
const { submitApplication, acknowledgePromotion, exitApplication } = require('../services/pipeline');

// POST /api/applications — submit a new application
router.post('/', async (req, res) => {
  const { job_id, applicant_name, applicant_email } = req.body;
  if (!job_id || !applicant_name || !applicant_email) {
    return res.status(400).json({ error: 'job_id, applicant_name, applicant_email required' });
  }
  try {
    const app = await submitApplication(job_id, applicant_name, applicant_email);
    res.status(201).json(app);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/applications/:id/status — applicant self-check
router.get('/:id/status', async (req, res) => {
  try {
    const { rows: [app] } = await pool.query(
      `SELECT a.id, a.applicant_name, a.status, a.waitlist_position,
              a.ack_deadline, a.decay_penalty_count,
              j.title AS job_title, j.company_name,
              (SELECT COUNT(*) FROM applications
               WHERE job_id = a.job_id AND status = 'waitlisted'
               AND waitlist_position < a.waitlist_position) AS ahead_in_queue
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (!app) return res.status(404).json({ error: 'Application not found' });
    res.json(app);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/applications/:id/acknowledge — applicant confirms they're still interested
router.post('/:id/acknowledge', async (req, res) => {
  try {
    const result = await acknowledgePromotion(req.params.id);
    res.json(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/applications/:id/exit — company moves someone out
router.post('/:id/exit', async (req, res) => {
  const { reason, status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required (withdrawn/rejected/hired)' });
  try {
    const result = await exitApplication(req.params.id, reason || 'No reason given', status);
    res.json(result);
  } catch (err) {
    const code = err.message.includes('not found') ? 404 : 400;
    res.status(code).json({ error: err.message });
  }
});

module.exports = router;