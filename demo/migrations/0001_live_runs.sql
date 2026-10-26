-- One row per live-run attempt, for the per-minute and per-day caps and the wrong-passcode pause.
-- No address, passcode, or browser detail is stored. Rows older than three days are deleted on the next attempt.
CREATE TABLE live_runs (
  id INTEGER PRIMARY KEY,
  at_ms INTEGER NOT NULL,                    -- when, in milliseconds since 1970 (UTC)
  case_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('started', 'done', 'error', 'bad_passcode'))
);
CREATE INDEX live_runs_at ON live_runs (at_ms);
