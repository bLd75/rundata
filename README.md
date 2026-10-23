# La Réunion en temps réel — serveur MCP

Ce serveur [MCP](https://modelcontextprotocol.io) donne à votre assistant IA (Claude, ChatGPT, Le Chat…) les **données publiques de La Réunion en ce moment** : météo mesurée aux stations, vigilance, mer, volcan, électricité, qualité de l'air, services publics, horaires de bus, terrain et risques. Il répond à des questions comme « quel temps fait-il à Saint-Pierre ? », « le prochain bus à la gare de Saint-Pierre ? » ou « le volcan est en éruption ? » avec des valeurs datées et sourcées. Une mesure n'est jamais mélangée à une prévision : pour « il va pleuvoir demain ? », un outil à part donne la prévision d'un modèle, toujours étiquetée comme telle.

> *English: an MCP server giving AI assistants the public data of Réunion Island right now (measured weather, warnings, sea, volcano, electricity, air quality, public offices, bus timetables, land and hazards), dated and sourced, with forecasts kept apart and clearly labelled. See [English summary](#english).*

## Outils

| Outil | Pour quelles questions | Ce qu'il renvoie |
|---|---|---|
| `meteo_actuelle(lieu)` | « il fait chaud à Saint-Gilles ? », « il pleut à Mafate ? », « du vent à Saint-Pierre ? » | Mesures de la station la plus représentative : température, pluie (6 min et 1 h), humidité, vent, rafales, pression, temps présent. Inclut l'heure, la distance, l'écart d'altitude et le versant. Ajoute la pluie vue par le radar de Météo-France au lieu même et à 3 km autour (image de 5 min, avec la qualité du radar, faible au fond des cirques). |
| `prevision_meteo(lieu, quand)` | « il va pleuvoir demain à Saint-Denis ? », « quel temps ce week-end à Cilaos ? » | **Prévision** du modèle AROME outre-mer de Météo-France (maille de 2,5 km) pour les 48 premières heures, puis du modèle IFS de l'ECMWF (9 km) jusqu'à 7 jours, par jour et par tranches de 3 h, températures ramenées à l'altitude du lieu ; chaque jour dit quel modèle a donné quelles heures. Chaque réponse porte `nature: "prevision"` et rappelle que ce n'est pas une mesure, que le modèle ne voit pas les microclimats, et que pour un cyclone seule compte la vigilance officielle. `quand` : « demain », « ce soir », « samedi », « ce week-end »… |
| `vigilance_meteo(lieu?)` | « il y a une alerte cyclonique ? », « vigilance fortes pluies dans l'Est ? » | Vigilance officielle de Météo-France : alerte cyclonique (jaune, orange, rouge…), et par zone fortes pluies / orages, vents forts, vagues-submersion, pour les 24 h du bulletin, avec les textes de suivi. Sans `lieu` : toute l'île ; avec : la zone du lieu. `meteo_actuelle` et `prevision_meteo` signalent d'elles-mêmes toute vigilance au-dessus du vert. |
| `temperature_mer(lieu)` | « l'eau est à combien à Boucan ? » | Dernière température de l'eau mesurée près du lieu, avec sa date, sa distance et sa nature (bouée ou satellite). |
| `volcan_seismes()` | « le volcan est en éruption ? », « on peut monter au volcan ? », « il y a eu un séisme ? » | Éruption en cours ou non, niveau ORSEC, dernière éruption, accès à l'Enclos (pitonlive.com, d'après les arrêtés préfectoraux), dernières publications de l'OVPF-IPGP et séismes localisés en 30 jours, sous le volcan et ailleurs. |
| `electricite()` | « d'où vient l'électricité ? », « quand recharger ma voiture électrique ? » | Production d'EDF toutes les 5 min par filière et part renouvelable ; « météo de l'électricité » d'EDF (heures de pointe, réseau contraint) pour les jours qui viennent. |
| `qualite_air(lieu?)` | « l'air est pollué à Saint-Louis ? » | Indice ATMO du jour et du lendemain par commune (Atmo Réunion), avec le polluant en cause. |
| `annuaire_services_publics(quoi, lieu?)` | « horaires de la mairie de Saint-Paul ? », « où est la CAF ? » | Adresse, horaires (ouvert en ce moment ?), téléphone et site des services publics, d'après l'annuaire de service-public.fr. |
| `transports(arret, ligne?)` | « prochain bus à la gare routière de Saint-Pierre ? », « à quelle heure passe le car jaune à Saint-Leu ? » | Prochains départs à l'arrêt (ligne, direction, heure, minutes d'attente), tous réseaux confondus : Car Jaune, Citalis, Kar'Ouest, Alternéo, CarSud, Estival, téléphérique Papang. Horaires publiés par les réseaux et, pour Car Jaune (et Alternéo, CarSud quand leur flux fonctionne), l'heure annoncée en temps réel, le retard, les arrêts non desservis et l'info trafic. Un lieu qui n'est pas un arrêt donne les arrêts les plus proches. |
| `velos_libre_service(lieu?)` | « il reste des vélos à la station IUT ? », « où prendre un vélo près du front de mer de Saint-Pierre ? » | Vélos à assistance électrique Altervélo en libre-service (Saint-Pierre, Saint-Louis, L'Étang-Salé), en direct : vélos à prendre et places libres de chaque station, stations les plus proches d'un lieu, ou tout le réseau. |
| `maree(lieu?)` | « la marée monte ? », « c'était quand la marée haute ? », « niveau de la mer au Port ? » | Hauteur d'eau mesurée chaque minute par les marégraphes du SHOM au Port (Pointe des Galets) et à Sainte-Marie : niveau, marée montante ou descendante, dernières pleine et basse mer observées. Pas de prévision d'horaires : celles du SHOM ne sont pas en données ouvertes. |
| `calendrier(lieu?)` | « c'est quand les vacances ? », « le 20 décembre est férié ? », « lever du soleil au Maïdo ? » | Vacances de l'académie de La Réunion, jours fériés (dont le 20 décembre), lever et coucher du soleil au lieu. |
| `fiche_terrain(adresse)` | « cette parcelle est constructible ? », « prix au m² à Boucan ? », « cette maison est en zone inondable ? » | Parcelle cadastrale (section, numéro, surface), zone du PLU (U, AU, A, N) avec le lien vers son règlement, altitude du sol, prix médians des maisons, appartements et terrains vendus autour depuis 5 ans (DVF, agrégés : aucune vente individuelle). Risques : le point est-il dans une zone réglementée d'un plan de prévention des risques (inondation, mouvements de terrain, littoral, ou technologique), avec le lien vers le plan ; arrêtés de catastrophe naturelle de la commune ; glissements et éboulements recensés à moins de 500 m ; sismicité et radon. |
| `sources_donnees()` | « d'où viennent ces chiffres ? » | Sources, licences et attributions. |

`lieu` est du texte libre : une commune, une plage, un quartier, un cirque, un sommet, ou des coordonnées `-21.05, 55.22`. Le répertoire contient environ 1 250 lieux tirés d'OpenStreetMap, avec leur altitude IGN.

**Les microclimats.** L'île monte de 0 à 3 000 m en 20 km. L'est est exposé aux alizés (« au vent »), l'ouest est abrité (« sous le vent »). Chaque réponse donne donc la pertinence de la station (`bonne` / `moyenne` / `faible`) et un avertissement quand la station est plus basse, plus loin ou sur l'autre versant. Une station du littoral ne répond jamais en silence pour Cilaos.

## Sources

| Source | Ce qu'elle mesure | Fraîcheur | Licence |
|---|---|---|---|
| Stations Météo-France, API Package Observations (clé gratuite, facultative) | ~56 stations, de la côte aux sommets : air, pluie, et pour une partie humidité, vent, pression | toutes les 6 min, publiées 5 à 10 min après | Licence Ouverte Etalab 2.0 |
| METAR Gillot et Pierrefonds (Météo-France, via NOAA aviationweather.gov) | air, humidité, vent, pression, temps présent | toutes les 30 min, environ 20 min de retard | données OMM, diffusion libre |
| Balises Pioupiou / [OpenWindMap](https://openwindmap.org) | vent | toutes les 4 min | licence communautaire OpenWindMap, attribution obligatoire |
| NOAA CoastWatch ACSPO L3S | température de surface de la mer, satellite, carrés de 2 km | quotidienne, environ 2 jours de retard | domaine public |
| NASA Aqua MODIS (via NOAA PFEG), en secours | idem, carrés de 4 km, de jour | quotidienne, environ 2 jours de retard | domaine public |
| Vigilance météo et alerte cyclonique, Météo-France (API DPVigilance, même clé) | couleurs par zone et par heure, textes de suivi | à chaque nouveau bulletin, lu toutes les 5 min | Licence Ouverte Etalab 2.0 |
| Radar Météo-France, lame d'eau de La Réunion à 500 m (API DPRadar, même clé) | pluie estimée par les radars du Colorado et de Piton Villers, avec un indice de qualité | toutes les 5 min | Licence Ouverte Etalab 2.0 |
| Séismes de l'OVPF-IPGP (service FDSN de l'IPGP) | séismes localisés sous le volcan et sur l'île, magnitude, profondeur | dès qu'un analyste les a localisés | CC BY 4.0 |
| Publications de l'OVPF-IPGP (son compte Bluesky public) | bulletins mensuels, communiqués, éruptions | à chaque publication | citées avec leur lien |
| [pitonlive.com](https://pitonlive.com) (site indépendant) | niveau ORSEC, éruption en cours, accès à l'Enclos d'après les arrêtés préfectoraux | lu toutes les 10 min | non précisée : cité avec son nom et son lien |
| EDF SEI Réunion, [open data](https://opendata-reunion.edf.fr) | production par filière ; « météo de l'électricité » | toutes les 5 min ; chaque jour | Licence Ouverte Etalab 2.0 |
| Calendrier scolaire (Éducation nationale) et jours fériés (calendrier.api.gouv.fr) | vacances de l'académie de La Réunion, jours fériés | lu une fois par jour | Licence Ouverte Etalab 2.0 |
| Indice ATMO d'Atmo Réunion (géoserveur d'Atmo France) | qualité de l'air par commune, polluant en cause | chaque jour, pour le jour et le lendemain | Licence Ouverte Etalab 2.0 |
| Annuaire de l'administration (service-public.fr, DILA) | adresses, horaires, téléphones des services publics | mis à jour par chaque service | Licence Ouverte Etalab 2.0 |
| Base adresse nationale et Géoplateforme de l'IGN : géocodage, cadastre (DGFiP), Géoportail de l'urbanisme, altitude RGE ALTI | adresse, parcelle, zone du PLU, altitude du sol | à chaque mise à jour des registres | Licence Ouverte Etalab 2.0 |
| Plans de prévention des risques (servitudes PM1 et PM3 publiées par la DEAL sur le Géoportail de l'urbanisme) | zones réglementées des PPR inondation, mouvements de terrain, littoral et technologiques | à chaque révision d'un plan | Licence Ouverte Etalab 2.0 |
| Géorisques (ministère de la Transition écologique, BRGM) | arrêtés de catastrophe naturelle, mouvements de terrain recensés (BDMvt), sismicité, radon | à chaque arrêté ou relevé | Licence Ouverte Etalab 2.0 |
| Horaires des réseaux de bus (GTFS) : Car Jaune (Région), Citalis et téléphérique Papang (CINOR), Kar'Ouest (TCO), Alternéo (CIVIS), CarSud (CASUD), Estival (CIREST), via [transport.data.gouv.fr](https://transport.data.gouv.fr) | horaires théoriques de ~10 000 arrêts ; préparés par `scripts/build-transit.py` dans une base Cloudflare D1 | à chaque nouvelle version publiée par un réseau | Licence Ouverte Etalab 2.0 |
| Bus en temps réel (GTFS-RT) : Car Jaune, Alternéo, CarSud, via [transport.data.gouv.fr](https://transport.data.gouv.fr) | heure annoncée de chaque course à ses prochains arrêts, courses et arrêts supprimés, info trafic ; rapprochés des horaires par course et par arrêt | chaque minute | Licence Ouverte Etalab 2.0 |
| Vélos en libre-service Altervélo (CIVIS, exploité par Ecovélo), flux GBFS via [transport.data.gouv.fr](https://transport.data.gouv.fr/datasets/velos-a-assistance-electrique-en-libre-service-saint-pierre-la-reunion-civis-altervelo) | vélos et places libres de chaque station | en direct (relu au plus chaque minute) | Licence Ouverte Etalab 2.0 |
| Marégraphes du SHOM, réseau RONIM ([REFMAR](https://data.shom.fr/donnees/refmar)) : Pointe des Galets (Le Port) et Sainte-Marie | hauteur d'eau au-dessus du zéro des cartes, données brutes | chaque minute, environ 4 min de retard | Licence Ouverte 2.0, citer « REFMAR. http://dx.doi.org/10.17183/REFMAR#RONIM » |
| Demandes de valeurs foncières (DGFiP), API DVF du Cerema | ventes immobilières, agrégées en médianes | deux fois par an | Licence Ouverte Etalab 2.0 |
| Prévisions AROME outre-mer, Météo-France (API « AROME », même clé que les observations ; outil `prevision_meteo` seulement) | prévision de modèle, maille de 2,5 km, 48 h | 4 calculs par jour | Licence Ouverte Etalab 2.0 |
| Prévisions ECMWF IFS HRES, via [Open-Meteo](https://open-meteo.com/) (outil `prevision_meteo` seulement, au-delà de 48 h et en secours) | prévision de modèle, maille de 9 km | nouveau calcul toutes les 6 h | CC BY 4.0 ; API Open-Meteo gratuite pour usage non commercial |

## Code source

https://github.com/bLd75/rundata — licence MIT (fichier [`LICENSE`](LICENSE)).

Ailleurs : la fiche de réutilisation sur [data.gouv.fr](https://www.data.gouv.fr/reuses/rundata-re-la-reunion-en-direct-meteo-mer-bus-velos-air-volcan-pour-vous-et-votre-assistant-ia), la fiche du serveur sur [Glama](https://glama.ai/mcp/servers/bLd75/rundata) et la page [Facebook](https://www.facebook.com/1432704299917309).

Chaque pull request fusionnée est mise en ligne sur rundata.re dès que les tests passent (`.github/workflows/deploy.yml`). Quand un réseau de bus publie de nouveaux horaires, ils sont importés dans D1 avant la fusion (`scripts/build-transit.py --d1 rundata-transports`) : sans eux, le déploiement s'arrête avant de mettre en ligne.

## Utilisation

**Dans votre assistant IA** : ajoutez un connecteur personnalisé avec l'adresse `https://rundata.re/mcp` (Claude.ai, ChatGPT, Le Chat…). Rien à installer, pas de compte.

**En local** (Node ≥ 20) : `npm install`, puis `npm run dev:http` (point d'accès `http://127.0.0.1:8787/mcp`, visible de cette machine seulement ; `HOST=0.0.0.0` pour l'ouvrir au réseau, par exemple dans un conteneur) ou `npm run dev:stdio`. `npm test` lance les tests, sans réseau.

**En conteneur** : `docker build -t rundata .` puis `docker run -i --rm rundata` lance le serveur en stdio (variables facultatives `METEOFRANCE_APPLICATION_ID` ou `METEOFRANCE_API_KEY` pour les stations, la vigilance et le radar de Météo-France).

## Le site

Les pages sont rendues par le serveur, données comprises, pour les moteurs de recherche et les aperçus de liens (`src/web/`). Le menu, les tuiles de l'accueil, le pied de page et le sitemap viennent d'une seule liste de catégories (`src/web/categories.ts`) :
- `/` : l'île en ce moment, une tuile par catégorie avec sa donnée du moment, puis comment brancher le connecteur ;
- `/meteo` : la météo de toute l'île (carte, stations de la côte aux sommets, mer), et `/meteo/<commune>` pour les 24 communes et quelques lieux (volcan, Maïdo, Hell-Bourg…), avec la station la plus pertinente, la mer sur la côte et la prévision, étiquetée ;
- `/communes/<commune>` : tout ce qui concerne une commune en ce moment (météo de sa station, vigilance de sa zone, air, mer sur la côte, prochains bus à sa gare ou près de son centre, mairie ouverte ou fermée, soleil), puis le volcan et l'électricité de toute l'île ; `/communes` les liste par zone ;
- `/vigilance` : la vigilance météo et l'alerte cyclonique, zone par zone ;
- `/mer` : la température de l'eau au large des plages ;
- `/volcan` : éruption ou non, accès à l'Enclos, séismes et messages de l'observatoire ;
- `/bus` : les réseaux et les prochains départs dans les gares routières ;
- `/air` : l'indice ATMO du jour dans chaque commune, sur une carte ;
- `/electricite` : la production d'électricité filière par filière, la part renouvelable et les heures de tension ;
- `/calendrier` : vacances scolaires, jours fériés, lever et coucher du soleil ;
- `/robots.txt`, `/sitemap.xml`, `/og.png` (aperçu Facebook, WhatsApp…), `/favicon.svg`.

## English

Public data for Réunion Island (French overseas department 974, Indian Ocean), live and sourced:

- **Tools:**
  - `meteo_actuelle(lieu)`: current weather at the most representative station.
  - `prevision_meteo(lieu, quand)`: model forecast (Météo-France AROME outre-mer 2.5 km for 48 h, then ECMWF IFS 9 km via Open-Meteo up to 7 days), always labelled as a forecast, never mixed with measurements.
  - `vigilance_meteo(lieu?)`: Météo-France's official weather warnings and cyclone alert, island-wide or for a place's zone.
  - `volcan_seismes()`: Piton de la Fournaise status (eruption, alert level, access) and recent earthquakes located by the OVPF-IPGP.
  - `electricite()`: EDF's real-time production mix, renewable share and grid signal for the coming days.
  - `calendrier(lieu?)`: school holidays (austral calendar), public holidays including 20 December, sunrise and sunset.
  - `qualite_air(lieu?)`: ATMO air quality index per commune, today and tomorrow.
  - `annuaire_services_publics(quoi, lieu?)`: addresses, opening hours and phone numbers of public offices.
  - `transports(arret, ligne?)`: next bus departures at a stop, all networks of the island (published timetables, and real-time times, delays and traffic alerts where the network publishes a GTFS-RT feed).
  - `velos_libre_service(lieu?)`: live Altervélo bike-share availability (e-bikes and free docks per station) in Saint-Pierre, Saint-Louis and L'Étang-Salé.
  - `maree(lieu?)`: measured sea level at Réunion's two SHOM tide gauges (Le Port, Sainte-Marie): level, rising or falling, last high and low water observed. No tide predictions.
  - `fiche_terrain(adresse)`: cadastral parcel, zoning (PLU), altitude, median property prices around (aggregated DVF), and natural hazards: risk prevention plan at the point, natural disaster decrees, landslides recorded within 500 m.
  - `meteo_actuelle` also reports the rain seen by Météo-France's radar at the place.
  - `temperature_mer(lieu)`: sea surface temperature near a beach.
  - `sources_donnees()`: sources and licences.
- **Places:** free text (town, beach, peak) or `lat, lon`.
- **Answers:** every answer carries the measurement time, the station distance, the altitude difference, the windward or leeward side, and a relevance flag.
- **Licences:** code under MIT. Data under each source's licence (see `sources_donnees`). Place names © OpenStreetMap contributors (ODbL), altitudes IGN (Licence Ouverte).
