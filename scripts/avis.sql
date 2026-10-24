-- The feedback table (src/avis.ts), in the D1 database bound as AVIS in wrangler.jsonc. Safe to run again.
-- npx wrangler d1 execute rundata-transports --remote --file scripts/avis.sql
--
-- t: Unix time in seconds; canal: « mcp » (tool donner_avis) or « site » (form, POST /avis); type: manque, erreur,
-- suggestion, bravo, or NULL from the form; client: the assistant, from its User-Agent; page: the form's page;
-- source: a salted hash of the sender's address and the day, only to refuse a flood, wiped after a day.
CREATE TABLE IF NOT EXISTS avis (
  id INTEGER PRIMARY KEY,
  t INTEGER NOT NULL,
  canal TEXT NOT NULL,
  type TEXT,
  outil TEXT,
  lieu TEXT,
  message TEXT NOT NULL,
  question TEXT,
  client TEXT,
  page TEXT,
  source TEXT
);
CREATE INDEX IF NOT EXISTS avis_t ON avis (t);
CREATE INDEX IF NOT EXISTS avis_source ON avis (source, t);
-- Each new row wipes the fingerprints older than a day and forgets the rows older than 12 months.
CREATE TRIGGER IF NOT EXISTS avis_oubli AFTER INSERT ON avis
BEGIN
  UPDATE avis SET source = NULL WHERE source IS NOT NULL AND t < NEW.t - 86400;
  DELETE FROM avis WHERE t < NEW.t - 31536000;
END;
