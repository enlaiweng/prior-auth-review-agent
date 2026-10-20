-- The labeling site's database (Cloudflare D1, SQLite). Applied by the deploy workflow with
-- `wrangler d1 migrations apply`. Times are ISO 8601 in UTC.

-- One row per invited labeler. The invite link's token is never stored, only its SHA-256.
CREATE TABLE labelers (
  id TEXT PRIMARY KEY,                 -- random id, for example lb_3f9a1c2e7b4d5a60
  token_hash TEXT NOT NULL UNIQUE,     -- SHA-256 (hex) of the current invite token
  invited_name TEXT NOT NULL,          -- the name the owner typed when inviting
  invited_email TEXT,                  -- optional, for the owner's records only
  note TEXT,                           -- optional, for the owner's records only
  credit_name TEXT,                    -- the name the labeler asked to be credited by
  role TEXT,                           -- the role or credentials the labeler entered
  consent_at TEXT,                     -- when the labeler agreed to the terms on the welcome page
  training_done_at TEXT,               -- when the labeler said they had done the training (self-reported)
  created_at TEXT NOT NULL,
  revoked_at TEXT                      -- set when the owner turns the link off
);

-- Which cases each labeler sees. Nobody sees a case that is not assigned to them.
CREATE TABLE assignments (
  labeler_id TEXT NOT NULL REFERENCES labelers(id),
  case_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (labeler_id, case_id)
);

-- One label per labeler and case. body is JSON: {criteria: {C1_red_flag: {status, evidence}, ...},
-- routing, gap_criterion, gap_missing}. Once submitted_at is set, the label cannot change unless the
-- owner reopens it, which is recorded in events.
CREATE TABLE labels (
  labeler_id TEXT NOT NULL REFERENCES labelers(id),
  case_id TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  content_sha TEXT NOT NULL,           -- fingerprint of the case content the labeler saw
  PRIMARY KEY (labeler_id, case_id)
);

-- Append-only audit trail: who did what, and when.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,                 -- "owner" or a labeler id
  labeler_id TEXT,
  case_id TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX events_by_labeler ON events (labeler_id, at);
