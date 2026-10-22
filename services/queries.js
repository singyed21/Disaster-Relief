const db = require('../config/db');

// Only confirmed money counts as raised. Unverified or cancelled pledges are never counted.
const DISASTER_STATS = `
  SELECT d.*,
    COALESCE((SELECT SUM(x.amount) FROM donations x WHERE x.disaster_id = d.id AND x.donation_type = 'money' AND x.status = 'completed'), 0) AS raised,
    COALESCE((SELECT SUM(a.amount) FROM fund_allocations a WHERE a.disaster_id = d.id), 0) AS allocated,
    (SELECT COUNT(*) FROM donations x WHERE x.disaster_id = d.id AND x.donation_type = 'money' AND x.status = 'completed') AS donor_count,
    (SELECT COUNT(*) FROM donations x WHERE x.disaster_id = d.id AND x.donation_type = 'medical' AND x.status NOT IN ('cancelled','unverified')) AS medical_count,
    (SELECT COUNT(*) FROM donations x WHERE x.disaster_id = d.id AND x.donation_type = 'rescue' AND x.status NOT IN ('cancelled','unverified')) AS rescue_count
  FROM disasters d`;

const SEVERITY_ORDER = `CASE d.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END`;

function globalStats() {
  return db.one(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE donation_type = 'money' AND status = 'completed'), 0) AS total_raised,
      COUNT(*) FILTER (WHERE donation_type = 'money' AND status = 'completed') AS money_donations,
      COUNT(*) FILTER (WHERE donation_type = 'medical' AND status NOT IN ('cancelled','unverified')) AS medical_pledges,
      COUNT(*) FILTER (WHERE donation_type = 'rescue' AND status NOT IN ('cancelled','unverified')) AS rescue_pledges,
      (SELECT COUNT(*) FROM disasters WHERE status = 'active') AS active_disasters,
      (SELECT COALESCE(SUM(amount), 0) FROM fund_allocations) AS total_allocated
    FROM donations`);
}

module.exports = { DISASTER_STATS, SEVERITY_ORDER, globalStats };