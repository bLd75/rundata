/** MonClub's pages as the tests need them (test/clubs.test.ts, test/club-pages.test.ts): made up, never a real club's. */

/** A club's address, of the federation's form. */
export const ADRESSE = "5974001@reunion.ffhandball.net";
/** An attribute's value as MonClub writes it: JSON, HTML-escaped. */
const attribut = (v: unknown) => JSON.stringify(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const feature = (id: number, title: string, zipcode: string, city: string, url: string, type = "smartfire-clubs") => ({ type: "Feature", properties: { id, title, address: "1 rue de l'Exemple", zipcode, city, url, type }, geometry: { type: "Point", coordinates: [55.5, -21.1] } });
export const CLUBS = "https://monclub.ffhandball.fr/clubs/";
export const ACCUEIL = `<html><body><smartfire-component name='home-map' attributes="${attribut({ title: "Trouver un club", geojson: { type: "FeatureCollection", features: [
  feature(101, "HANDBALL CLUB DU TAMPON", "97430", "LE TAMPON", `${CLUBS}handball-club-du-tampon/`),
  feature(102, "ST PIERRE HAND & CO", "97410", "ST PIERRE", `${CLUBS}st-pierre-hand/`),
  feature(103, "CLUB DE HAND DE STE MARIE", "97494", "SAINTE MARIE Cedex", `${CLUBS}club-de-hand-de-ste-marie/`),
  feature(104, "HANDBALL CLUB DE BRETAGNE", "29410", "PLEYBER CHRIST", `${CLUBS}handball-club-de-bretagne/`),
  feature(105, "LIGUE DE LA REUNION", "97490", "SAINTE CLOTILDE", "https://monclub.ffhandball.fr/ligues/ligue-de-la-reunion/"),
  feature(106, "PRATIQUE", "97430", "LE TAMPON", `${CLUBS}pratique/`, "smartfire-practices"),
] } })}"></smartfire-component></body></html>`;

/** A club's page: its post, with its address in its data, and a neighbour's post besides. */
export const fiche = (ref: string, email: string | undefined, voisin?: { ref: string; email: string }) => {
  const post = (id: string, e?: string) => ({ post: { ID: Number(id), post_title: "UN CLUB", post_type: "smartfire-clubs", acf: { address_club: "1 rue de l'Exemple", zipcode_club: "97430", ...(e !== undefined && { email_club: e }), register_link: "https://example.org/inscription" } } });
  return `<html><body><smartfire-component name='single-club---home-hero-club' attributes="${attribut(post(ref, email))}"></smartfire-component>${voisin ? `<smartfire-component name='autre' attributes="${attribut(post(voisin.ref, voisin.email))}"></smartfire-component>` : ""}</body></html>`;
};

