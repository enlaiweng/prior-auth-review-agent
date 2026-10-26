-- Wrong passcodes are limited per visitor as well as overall, so one visitor can't pause live runs for everyone.
-- "who" is a keyed fingerprint of the visitor's network address and the day (HMAC-SHA256 with the passcode as the key),
-- kept only on wrong-passcode rows. It can't be turned back into an address, changes every day, and like every row is
-- deleted after three days.
ALTER TABLE live_runs ADD COLUMN who TEXT;
CREATE INDEX live_runs_who ON live_runs (who, at_ms);
