-- What the clubs and associations send through /associations (src/propositions.ts), in the D1 database bound as AVIS
-- in wrangler.jsonc, next to the feedback. Safe to run again.
-- npx wrangler d1 execute rundata-transports --remote --file scripts/propositions.sql
--
-- liens: « Nous donner votre lien ». t: Unix time in seconds; contact: the organisation's e-mail or phone, optional,
-- never published; page: the form's page; source: a salted hash of the sender's address and the day, only to refuse a
-- flood, wiped after a day. traite_le, suite: written by the moderation script once the link is dealt with (« lu
-- depuis 0.180.0 », « ne répond pas »), never anything about the sender. A row goes after 12 months.
CREATE TABLE IF NOT EXISTS liens (
  id INTEGER PRIMARY KEY,
  t INTEGER NOT NULL,
  nom TEXT NOT NULL,
  commune TEXT NOT NULL,
  lien TEXT NOT NULL,
  contact TEXT,
  page TEXT,
  source TEXT,
  traite_le INTEGER,
  suite TEXT
);
CREATE INDEX IF NOT EXISTS liens_source ON liens (source, t);
CREATE TRIGGER IF NOT EXISTS liens_oubli AFTER INSERT ON liens
BEGIN
  UPDATE liens SET source = NULL WHERE source IS NOT NULL AND t < NEW.t - 86400;
  DELETE FROM liens WHERE t < NEW.t - 31536000;
END;

-- propositions: « Proposer un événement ». etat: a_confirmer (the author has not clicked the e-mailed link yet),
-- a_moderer, publie, refuse, annule, reporte. jeton: the SHA-256 of the link's secret, never the secret. date, jusqu_au,
-- derniere_date: local days « 2026-11-14 »; debut, fin: « 18:00 »; repete: semaine, mois or NULL. email: the author's,
-- never published, wiped 30 days after derniere_date. contact_public: the contact shown with the event, only when its
-- author asked (the e-mail, or the club's address or phone), wiped with the e-mail. confirme_le, modere_le,
-- modifie_le: Unix times; motif: why a proposal was refused, in a few words, never about the author; reporte_au: the
-- new day of a postponed event.
CREATE TABLE IF NOT EXISTS propositions (
  id INTEGER PRIMARY KEY,
  t INTEGER NOT NULL,
  etat TEXT NOT NULL,
  jeton TEXT NOT NULL UNIQUE,
  titre TEXT NOT NULL,
  date TEXT NOT NULL,
  debut TEXT NOT NULL,
  fin TEXT,
  repete TEXT,
  jusqu_au TEXT,
  commune TEXT NOT NULL,
  lieu TEXT NOT NULL,
  organisateur TEXT NOT NULL,
  description TEXT NOT NULL,
  prix TEXT NOT NULL,
  lien TEXT,
  email TEXT,
  contact_public TEXT,
  derniere_date TEXT NOT NULL,
  source TEXT,
  confirme_le INTEGER,
  modere_le INTEGER,
  motif TEXT,
  modifie_le INTEGER,
  reporte_au TEXT
);
CREATE INDEX IF NOT EXISTS propositions_source ON propositions (source, t);
CREATE INDEX IF NOT EXISTS propositions_etat ON propositions (etat, date);
-- Each new row wipes the fingerprints older than a day, forgets the proposals never confirmed after 48 hours, wipes
-- the authors' addresses and public contacts 30 days after their event's last date (La Réunion's day), and forgets
-- the rows after 12 months. The daily scheduled event runs the same statements, for the days nothing is proposed.
CREATE TRIGGER IF NOT EXISTS propositions_oubli AFTER INSERT ON propositions
BEGIN
  UPDATE propositions SET source = NULL WHERE source IS NOT NULL AND t < NEW.t - 86400;
  DELETE FROM propositions WHERE etat = 'a_confirmer' AND t < NEW.t - 172800;
  UPDATE propositions SET email = NULL, contact_public = NULL WHERE (email IS NOT NULL OR contact_public IS NOT NULL) AND derniere_date < date(NEW.t, 'unixepoch', '+4 hours', '-30 days');
  DELETE FROM propositions WHERE t < NEW.t - 31536000;
END;
