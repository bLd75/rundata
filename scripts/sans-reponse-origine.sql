-- Cuts to the site's root the addresses that failed reads wrote before src/sans-reponse.ts kept only the root
-- (origineDe): their query or path could hold what a person asked (an address given to fiche_terrain) or a key.
-- Only the rows written by a read (no name, no verifier); the seed's pages stay. Safe to run again.
-- npx wrangler d1 execute rundata-transports --remote --file scripts/sans-reponse-origine.sql
UPDATE sans_reponse
SET url = substr(url, 1, instr(substr(url, 9), '/') + 8)
WHERE nom IS NULL AND verifier IS NULL AND url LIKE 'http%://%' AND instr(substr(url, 9), '/') > 0
  AND url <> substr(url, 1, instr(substr(url, 9), '/') + 8);
