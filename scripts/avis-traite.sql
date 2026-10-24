-- Adds to a table made before them the two columns of scripts/avis.sql that say a feedback was dealt with. Run once:
-- a second run stops at « duplicate column name », with nothing changed.
-- npx wrangler d1 execute rundata-transports --remote --file scripts/avis-traite.sql
ALTER TABLE avis ADD COLUMN traite_le INTEGER;
ALTER TABLE avis ADD COLUMN suite TEXT;
