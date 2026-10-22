const router = require('express').Router();
const db = require('../config/db');
const q = require('../services/queries');

// Public transparency dashboard: every number here is computed live from the donations ledger.
router.get('/dashboard', async (req, res) => {
  const [stats, disasters, ledger, allocations] = await Promise.all([
    q.globalStats(),
    db.any(`${q.DISASTER_STATS} ORDER BY d.status ASC, ${q.SEVERITY_ORDER}, d.created_at DESC`),
    db.any(
      `SELECT d.reference, d.donation_type, d.amount, d.currency, d.status, d.created_at,
             CASE WHEN d.is_anonymous THEN 'Anonymous' ELSE d.donor_name END AS donor,
             x.title AS disaster_title
        FROM donations d JOIN disasters x ON x.id = d.disaster_id
       WHERE d.status NOT IN ('unverified','pending','verifying','failed')
       ORDER BY d.created_at DESC LIMIT 25`
    ),
    db.any(
      `SELECT a.*, x.title AS disaster_title
         FROM fund_allocations a JOIN disasters x ON x.id = a.disaster_id
        ORDER BY a.spent_on DESC, a.id DESC LIMIT 20`
    )
  ]);
  res.render('dashboard', { title: 'Transparency dashboard', stats, disasters, ledger, allocations });
});

module.exports = router;