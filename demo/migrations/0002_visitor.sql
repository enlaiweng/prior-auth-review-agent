-- Wrong passcodes are limited per visitor (5 in ten minutes) as well as overall (50), so one visitor alone can't pause
-- live runs for everyone; someone with ten or more networks still could, for a while (availability only).
-- "who" is a keyed fingerprint of the visitor's network (an IPv4 address, or an IPv6 address's first 64 bits) and the
-- day: HMAC-SHA256 keyed by VISITOR_KEY, a random value each deploy makes and nobody sees. It is kept only on
-- wrong-passcode rows, can't be turned back into an address, changes every day, and like every row is deleted after
-- three days.
ALTER TABLE live_runs ADD COLUMN who TEXT;
CREATE INDEX live_runs_who ON live_runs (who, at_ms);
