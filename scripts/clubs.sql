-- The clubs' and associations' own space (src/clubs/espace.ts, web/club.ts), in the D1 database bound as AVIS in
-- wrangler.jsonc, next to the proposals. Safe to run again.
-- npx wrangler d1 execute rundata-transports --remote --file scripts/clubs.sql
--
-- clubs: the clubs whose official address a public source gives, and those checked by hand. All times: Unix seconds.
-- source: « monclub » (level 1, the Fédération française de handball's MonClub: the address the federation makes for
-- each club) or « manuel » (level 3, checked by hand by the team); ref: the club's identifier there (a MonClub page's
-- id); fiche: its page there, where its address is read again at each send. nom, commune, activite: as shown on screen
-- 1. vu_le: the last reading of the source that listed it; retire_le: gone from the source since, no longer proposed.
-- email: never for levels 1 and 2 (read again at the source at each send, then forgotten); for level 3 only, the
-- address checked by hand on adresse_le, never published, wiped 12 months after the space's last use. verifie_le: the
-- last click on « Ouvrir mon espace » (the verification by the official address); accord_le: the first one, which
-- agreed to the licence and the rules; utilise_le: the space's last use.
CREATE TABLE IF NOT EXISTS clubs (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('monclub', 'manuel')),
  ref TEXT NOT NULL,
  niveau INTEGER NOT NULL CHECK (niveau IN (1, 2, 3)),
  nom TEXT NOT NULL,
  commune TEXT,
  activite TEXT NOT NULL,
  fiche TEXT,
  vu_le INTEGER NOT NULL,
  retire_le INTEGER,
  email TEXT CHECK (email IS NULL OR niveau = 3),
  adresse_le INTEGER,
  verifie_le INTEGER,
  accord_le INTEGER,
  utilise_le INTEGER,
  UNIQUE (source, ref)
);

-- acces: the links into a space; jeton: the SHA-256 of the link's secret, never the secret. type « lien »: the link
-- e-mailed to the official address, valid 48 hours, used once; type « espace »: the personal link « Mon agenda » is
-- opened with, one per club (a new one replaces it), valid 12 months after its last use (utilise_le, else t).
CREATE TABLE IF NOT EXISTS acces (
  jeton TEXT PRIMARY KEY,
  club INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('lien', 'espace')),
  t INTEGER NOT NULL,
  utilise_le INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS acces_club ON acces (club, type);

-- envois: the trace of each link asked for a club, sent or not, without its address: which club, what (« lien »),
-- when, and for a day the fingerprint of the connection that asked (a salted hash of its address, or of its /64, and
-- the day: src/avis.ts), never the address. Counts the links asked for a day, per club and per connection; kept 12 months.
CREATE TABLE IF NOT EXISTS envois (
  club INTEGER NOT NULL,
  type TEXT NOT NULL,
  t INTEGER NOT NULL,
  source TEXT
);
CREATE INDEX IF NOT EXISTS envois_club ON envois (club, type, t);
CREATE INDEX IF NOT EXISTS envois_t ON envois (t);
CREATE INDEX IF NOT EXISTS envois_source ON envois (source, t);

-- Each new e-mailed link forgets the links older than 48 hours, and each link asked the fingerprints older than a day.
-- The daily scheduled event does the rest (espace.ts `purger`): the personal links unused for 12 months, the trace
-- after 12 months, a level 3 address 12 months after the space's last use.
CREATE TRIGGER IF NOT EXISTS acces_oubli AFTER INSERT ON acces WHEN NEW.type = 'lien'
BEGIN
  DELETE FROM acces WHERE type = 'lien' AND t < NEW.t - 172800;
END;
CREATE TRIGGER IF NOT EXISTS envois_oubli AFTER INSERT ON envois
BEGIN
  UPDATE envois SET source = NULL WHERE source IS NOT NULL AND t < NEW.t - 86400;
END;
