-- Disaster Relief Portal schema (safe to run more than once)

CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(120) NOT NULL,
  email             VARCHAR(255) NOT NULL UNIQUE,
  phone             VARCHAR(40),
  password_hash     VARCHAR(255) NOT NULL,
  role              VARCHAR(10) NOT NULL DEFAULT 'donor' CHECK (role IN ('donor', 'admin')),
  email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  verify_token_hash VARCHAR(64),
  verify_expires    TIMESTAMPTZ,
  reset_token_hash  VARCHAR(64),
  reset_expires     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disasters (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  disaster_type VARCHAR(30) NOT NULL DEFAULT 'other'
                CHECK (disaster_type IN ('flood','earthquake','landslide','fire','storm','drought','other')),
  location      VARCHAR(200) NOT NULL,
  description   TEXT NOT NULL,
  severity      VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status        VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  goal_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (goal_amount >= 0),
  image_url     VARCHAR(500),
  needs_medical TEXT,
  needs_rescue  TEXT,
  started_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disaster_updates (
  id          SERIAL PRIMARY KEY,
  disaster_id INTEGER NOT NULL REFERENCES disasters(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS donations (
  id               SERIAL PRIMARY KEY,
  reference        VARCHAR(30) NOT NULL UNIQUE,
  user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  disaster_id      INTEGER NOT NULL REFERENCES disasters(id) ON DELETE RESTRICT,
  donation_type    VARCHAR(10) NOT NULL CHECK (donation_type IN ('money','medical','rescue')),
  donor_name       VARCHAR(120) NOT NULL,
  donor_email      VARCHAR(255) NOT NULL,
  donor_phone      VARCHAR(40),
  is_anonymous     BOOLEAN NOT NULL DEFAULT FALSE,
  message          TEXT,
  -- money
  amount           NUMERIC(14,2),
  currency         VARCHAR(3),
  payment_provider VARCHAR(20),
  provider_ref     VARCHAR(120),
  -- medical support
  item_description TEXT,
  quantity         INTEGER,
  -- rescue team
  skills           TEXT,
  team_size        INTEGER,
  availability     TEXT,
  status           VARCHAR(12) NOT NULL
                   CHECK (status IN ('pending','completed','failed','refunded','pledged','received','dispatched','delivered','cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  CONSTRAINT money_has_amount CHECK (donation_type <> 'money' OR (amount IS NOT NULL AND amount > 0 AND currency IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_donations_disaster ON donations(disaster_id);
CREATE INDEX IF NOT EXISTS idx_donations_user ON donations(user_id);
CREATE INDEX IF NOT EXISTS idx_donations_email ON donations(LOWER(donor_email));

-- Public tracing timeline for every donation
CREATE TABLE IF NOT EXISTS donation_updates (
  id          SERIAL PRIMARY KEY,
  donation_id INTEGER NOT NULL REFERENCES donations(id) ON DELETE CASCADE,
  status      VARCHAR(12) NOT NULL,
  note        TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_donation_updates_donation ON donation_updates(donation_id);

-- How collected money was actually spent (shown publicly for transparency)
CREATE TABLE IF NOT EXISTS fund_allocations (
  id          SERIAL PRIMARY KEY,
  disaster_id INTEGER NOT NULL REFERENCES disasters(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  spent_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  email      VARCHAR(255) NOT NULL,
  subject    VARCHAR(200) NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(80) NOT NULL,
  details    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
