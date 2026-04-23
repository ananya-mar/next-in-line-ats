CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE job_status AS ENUM ('open', 'closed');
CREATE TYPE app_status AS ENUM (
  'active',
  'waitlisted',
  'pending_ack',
  'withdrawn',
  'rejected',
  'hired'
);

CREATE TABLE jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  company_name    TEXT NOT NULL,
  active_capacity INT  NOT NULL CHECK (active_capacity > 0),
  status          job_status NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE applications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  applicant_name      TEXT NOT NULL,
  applicant_email     TEXT NOT NULL,
  status              app_status NOT NULL DEFAULT 'waitlisted',
  waitlist_position   INT,          -- NULL when active/pending_ack/terminal
  decay_penalty_count INT NOT NULL DEFAULT 0,
  promoted_at         TIMESTAMPTZ,  -- when they entered pending_ack
  ack_deadline        TIMESTAMPTZ,  -- promoted_at + 24h
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, applicant_email)
);

CREATE TABLE pipeline_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX idx_applications_job_waitlist
  ON applications(job_id, waitlist_position)
  WHERE status = 'waitlisted';


CREATE INDEX idx_applications_ack_deadline
  ON applications(ack_deadline)
  WHERE status = 'pending_ack';