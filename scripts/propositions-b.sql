-- What the secret link of a proposal needs beyond scripts/propositions.sql (src/propositions.ts). Run ONCE, after it:
-- npx wrangler d1 execute rundata-transports --remote --file scripts/propositions-b.sql
-- (a second run stops at the ALTER, the column being there: nothing is lost).
--
-- correction: a correction of a published event by its author, as JSON (the same fields as the row, never the
-- address), waiting for the moderation; the published version stays shown meanwhile. Wiped with the address.
ALTER TABLE propositions ADD COLUMN correction TEXT;
-- The rows are now forgotten a year after their event's last date, not after their proposal: a weekly training
-- extended three months at a time stays while it goes on.
DROP TRIGGER IF EXISTS propositions_oubli;
CREATE TRIGGER propositions_oubli AFTER INSERT ON propositions
BEGIN
  UPDATE propositions SET source = NULL WHERE source IS NOT NULL AND t < NEW.t - 86400;
  DELETE FROM propositions WHERE etat = 'a_confirmer' AND t < NEW.t - 172800;
  UPDATE propositions SET email = NULL, contact_public = NULL, correction = NULL WHERE (email IS NOT NULL OR contact_public IS NOT NULL OR correction IS NOT NULL) AND derniere_date < date(NEW.t, 'unixepoch', '+4 hours', '-30 days');
  DELETE FROM propositions WHERE derniere_date < date(NEW.t, 'unixepoch', '+4 hours', '-1 year');
END;
