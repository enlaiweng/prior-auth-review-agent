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
-- routing, gap_criterion, gap_missing}. rev goes up by one with every save, so a save made from an older copy of the
-- label (another tab or device) is refused instead of overwriting a newer one. Once submitted_at is set, the label
-- cannot change unless the owner reopens it, which is recorded in events.
CREATE TABLE labels (
  labeler_id TEXT NOT NULL REFERENCES labelers(id),
  case_id TEXT NOT NULL,
  body TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  content_sha TEXT NOT NULL,           -- fingerprint of all the site's case content when the labeler loaded it
  case_sha TEXT NOT NULL,              -- fingerprint of this case's record, as the labeler's page showed it
  PRIMARY KEY (labeler_id, case_id)
);

-- The audit trail: who did what, and when. Rows are never changed or deleted, with one exception: when a person asks
-- for their details to be removed, the detail column of their rows is cleared (and that removal is itself recorded).
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

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'the audit trail is append-only');
END;

CREATE TRIGGER events_only_redact BEFORE UPDATE ON events
WHEN NOT (NEW.detail IS NULL AND NEW.id = OLD.id AND NEW.at = OLD.at AND NEW.actor = OLD.actor
          AND NEW.labeler_id IS OLD.labeler_id AND NEW.case_id IS OLD.case_id AND NEW.action = OLD.action)
BEGIN
  SELECT RAISE(ABORT, 'the audit trail is append-only; only a removal request may clear details');
END;
