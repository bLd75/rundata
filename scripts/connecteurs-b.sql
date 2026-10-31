-- Adds to a connexions table made before it the column of scripts/connecteurs.sql that says an association chose to
-- have its events in the open data (agenda ICS and JSON, Licence Ouverte 2.0). Run once: a second run stops at
-- « duplicate column name », with nothing changed. The links made before keep 0: out of the open data.
-- npx wrangler d1 execute rundata-transports --remote --file scripts/connecteurs-b.sql
ALTER TABLE connexions ADD COLUMN ouvert INTEGER NOT NULL DEFAULT 0 CHECK (ouvert IN (0, 1));
