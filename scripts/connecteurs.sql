-- The platforms the clubs and associations link to rundata.re (src/connecteurs/), in the D1 database bound as AVIS in
-- wrangler.jsonc, next to the proposals. Safe to run again.
-- npx wrangler d1 execute rundata-transports --remote --file scripts/connecteurs.sql
--
-- connexions: one association's link to one platform. t, confirme_le, modere_le, lu_le, reussi_le: Unix seconds.
-- plateforme: « helloasso »; organisation: the association's identifier there (its slug), nom, commune, code_postal,
-- lien: as the platform gives them (its public page). secret: what the platform needs to read again (a HelloAsso
-- refresh token), encrypted with the Worker's secret CONNECTEURS_CLE (src/connecteurs/chiffre.ts), never in clear; the
-- keys the association pasted are never kept. email: where to send the link that withdraws the access, never published.
-- jeton: the SHA-256 of that link's secret, never the secret; jeton_retrait: the same for the second link that
-- withdraws, sent with the reminder (rappel_le, after 25 days without a successful read), so that the first one keeps
-- working. etat: a_confirmer (the e-mailed link not clicked yet), a_moderer, actif, refuse, expire (no successful read
-- for 30 days). echecs, erreur: the failed reads in a row and the last one, in a few words (the step and the HTTP
-- status), never what the platform answered. source: a salted hash of the sender's address and the day, only to refuse
-- a flood, wiped after a day. ouvert: 1 when the association chose, while linking, to have its events in the open
-- data too (agenda ICS and JSON, Licence Ouverte 2.0), as HelloAsso agreed in writing; 0 otherwise. A withdrawal
-- deletes the row, and its events with it. A table made before ouvert: scripts/connecteurs-b.sql.
CREATE TABLE IF NOT EXISTS connexions (
  id INTEGER PRIMARY KEY,
  t INTEGER NOT NULL,
  plateforme TEXT NOT NULL,
  organisation TEXT NOT NULL,
  nom TEXT NOT NULL,
  commune TEXT,
  code_postal TEXT,
  lien TEXT NOT NULL,
  secret TEXT,
  email TEXT,
  jeton TEXT NOT NULL UNIQUE,
  jeton_retrait TEXT UNIQUE,
  etat TEXT NOT NULL CHECK (etat IN ('a_confirmer', 'a_moderer', 'actif', 'refuse', 'expire')),
  confirme_le INTEGER,
  modere_le INTEGER,
  lu_le INTEGER,
  reussi_le INTEGER,
  echecs INTEGER NOT NULL DEFAULT 0,
  erreur TEXT,
  rappel_le INTEGER,
  source TEXT,
  ouvert INTEGER NOT NULL DEFAULT 0 CHECK (ouvert IN (0, 1))
);
-- One confirmed link per association and platform: a new one waits beside it, unconfirmed, and replaces it once confirmed.
CREATE UNIQUE INDEX IF NOT EXISTS connexions_une ON connexions (plateforme, organisation) WHERE etat IN ('a_moderer', 'actif');
CREATE INDEX IF NOT EXISTS connexions_lecture ON connexions (etat, lu_le);
CREATE INDEX IF NOT EXISTS connexions_source ON connexions (source, t);

-- evenements_connectes: the public events read on the platform, nothing else. id: the event's identifier there (a
-- HelloAsso form's slug); maj: when the platform says it last changed, to read its details again only then. debut,
-- fin: local times « 2026-11-14T18:00 », La Réunion's. prix: as said (« Gratuit », « 10 € », « de 5 à 15 € »).
-- description: its first sentence, as the other agendas keep. lien: its page on the platform.
CREATE TABLE IF NOT EXISTS evenements_connectes (
  connexion INTEGER NOT NULL,
  id TEXT NOT NULL,
  maj TEXT NOT NULL,
  titre TEXT NOT NULL,
  debut TEXT NOT NULL,
  fin TEXT,
  lieu TEXT,
  adresse TEXT,
  commune TEXT,
  code_postal TEXT,
  prix TEXT,
  description TEXT,
  lien TEXT NOT NULL,
  PRIMARY KEY (connexion, id)
) WITHOUT ROWID;

-- A withdrawn link takes its events with it.
CREATE TRIGGER IF NOT EXISTS connexions_retrait AFTER DELETE ON connexions
BEGIN
  DELETE FROM evenements_connectes WHERE connexion = OLD.id;
END;
-- A refused or expired link keeps neither its secret, nor its address, nor its events: only its name, for the moderation.
CREATE TRIGGER IF NOT EXISTS connexions_fin AFTER UPDATE OF etat ON connexions WHEN NEW.etat IN ('refuse', 'expire')
BEGIN
  UPDATE connexions SET secret = NULL, email = NULL WHERE id = NEW.id;
  DELETE FROM evenements_connectes WHERE connexion = NEW.id;
END;
-- Each new row wipes the fingerprints older than a day, forgets the links never confirmed after 48 hours (their
-- encrypted secret with them) and the refused or expired ones after 30 days. The daily scheduled event runs the same
-- statements, for the days nobody links anything.
CREATE TRIGGER IF NOT EXISTS connexions_oubli AFTER INSERT ON connexions
BEGIN
  UPDATE connexions SET source = NULL WHERE source IS NOT NULL AND t < NEW.t - 86400;
  DELETE FROM connexions WHERE etat = 'a_confirmer' AND t < NEW.t - 172800;
  DELETE FROM connexions WHERE etat IN ('refuse', 'expire') AND COALESCE(modere_le, lu_le, t) < NEW.t - 2592000;
END;
