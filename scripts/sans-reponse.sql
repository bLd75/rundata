-- The public sites that do not answer (src/sans-reponse.ts, page /sites-sans-reponse, tool sites_sans_reponse), in the
-- D1 database bound as AVIS in wrangler.jsonc. Safe to run again: the seed never overwrites a row already there.
-- npx wrangler d1 execute rundata-transports --remote --file scripts/sans-reponse.sql
--
-- One row per host (« www. » left out). Times are Unix seconds. statut: a_verifier (seen failing by a read, never shown
-- until the morning's recheck confirms it), injoignable, bloque (answers, but not to our reads: a 403 or 429 twice in a
-- row), revenu (kept 7 days, then deleted). constat: http_503 (any 5xx), maintenance, delai, connexion, dns, http_404,
-- http_403, flux_vide. nom, theme, manque, page: how the page names the site, the part it is listed in, what is missing
-- on rundata.re and the page that would show it; NULL takes them from the sources read (sources_donnees). verifier:
-- for a site that answers with an empty feed, {"url", "date" (a regular expression, group 1 an ISO date), "age_max_h"}.
-- WITHOUT ROWID: one write per row changed, not two.
CREATE TABLE IF NOT EXISTS sans_reponse (
  hote TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  nom TEXT,
  theme TEXT,
  manque TEXT,
  page TEXT,
  sources TEXT NOT NULL DEFAULT '[]',
  statut TEXT NOT NULL CHECK (statut IN ('a_verifier', 'injoignable', 'bloque', 'revenu')),
  premier_echec INTEGER NOT NULL,
  dernier_essai INTEGER,
  constat TEXT NOT NULL,
  revenu_le INTEGER,
  n403 INTEGER NOT NULL DEFAULT 0,
  verifier TEXT
) WITHOUT ROWID;
-- When the last recheck ran, for the page's « dernier passage ».
CREATE TABLE IF NOT EXISTS sans_reponse_passage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  t INTEGER NOT NULL
);

-- The seed (25/10/2026): only the sites the code reads, from the list kept until then by hand. The IPGP's site is
-- silent since 21/10, as the OVPF says publicly; the ACSPO server answers again since 25/10 16:29. The others have no
-- sure failure seen from the Worker: « a_verifier », the morning's recheck sorts them.
INSERT OR IGNORE INTO sans_reponse (hote, url, nom, theme, manque, page, sources, statut, premier_echec, constat, revenu_le) VALUES
  ('ipgp.fr', 'https://www.ipgp.fr/volcanoweb/reunion/Bulletins-Communiques/2026/Communiques/OVPF_20260924_09h00_communique_AugmentationSismicite.pdf',
    'l''OVPF-IPGP', 'Volcan', 'les bulletins et communiqués de l''OVPF sur le Piton de la Fournaise', '/volcan', '["ovpf_pdf"]', 'injoignable', 1792526400, 'delai', NULL),
  ('coastwatch.noaa.gov', 'https://coastwatch.noaa.gov/',
    'NOAA CoastWatch', 'Mer', 'la température de la mer mesurée par satellite (ACSPO)', '/mer', '["acspo"]', 'revenu', 1792866300, 'http_404', 1792931340),
  ('coastwatch.pfeg.noaa.gov', 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdMH1sstd1day_R2022NRTMasked.html',
    'NOAA CoastWatch West Coast', 'Mer', 'la température de la mer mesurée par satellite (MODIS)', '/mer', '["modis"]', 'a_verifier', 1792872240, 'delai', NULL),
  ('reunion.gouv.fr', 'https://www.reunion.gouv.fr/',
    'la préfecture de La Réunion', 'Services de l''État', 'les communiqués de la préfecture, l''accès au volcan et les prix maximum des carburants', '/actualites', '["prefecture_communiques", "prefecture_carburants"]', 'a_verifier', 1792612800, 'maintenance', NULL),
  ('georisques.gouv.fr', 'https://www.georisques.gouv.fr/api/v1/gaspar/catnat?code_insee=97411&page_size=1',
    'Géorisques', 'Terrain et risques', 'les arrêtés de catastrophe naturelle et les mouvements de terrain de la fiche terrain', NULL, '["georisques"]', 'a_verifier', 1792587600, 'maintenance', NULL);
