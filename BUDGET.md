# Budget

Ce que coûte chaque lecture de rundata.re : ce qui la lance, sa cadence et son décalage, ce que prend une exécution à froid, et les totaux face aux limites de la plateforme et du code (src/budget.ts).

<!-- Généré à partir de src/registre.ts par `npx tsx scripts/build-budget.ts` : modifier les déclarations là-bas. -->

Les chiffres « mesuré » sont le plus haut relevé du 23/10/2026 23:07 au 25/10/2026 23:07, heure de La Réunion, dans les journaux du Worker : sous-requêtes d'une vue ou d'un appel, refusées comprises, et CPU arrondi au-dessus. « code » : lu dans le code (une borne, un compte). « estimé » : d'après la mesure d'une lecture voisine. Une écriture KV compte aussi les listes de clés.

## Limites

- 10 000 sous-requêtes par invocation, et 1 000 appels à KV, D1 et aux autres services liés, ensemble.
- 5 lectures en vol à la fois par invocation (src/http.ts), sur les 6 connexions que la plateforme ouvre ensemble.
- Tâche planifiée : toutes les 5 minutes, 500 sous-requêtes, 30 000 ms de CPU.
- Mémoire : 128 Mo par isolat, pour toutes les invocations qu'il sert ensemble.
- Une visite ou une question : 200 sous-requêtes. Une construction de copie : 100.

## Totaux

| contrôle | valeur | limite |
|---|---:|---:|
| pire passage planifié, sous-requêtes | 352 | 500 |
| pire passage planifié, appels KV et D1 | 55 | 1 000 |
| pire passage planifié, CPU (ms) | 2 082 | 30 000 |
| pire passage planifié, mémoire déclarée (Mo) | 30 | 128 |
| passage le plus chargé (cadences les plus courtes), sous-requêtes | 125 | 500 |
| vue la plus chère, sous-requêtes | 82 | 200 |
| question la plus chère, sous-requêtes | 65 | 200 |
| construction de copie la plus chère, sous-requêtes | 56 | 100 |

- Pire passage planifié : toutes les entrées planifiées dues ensemble, à froid (après un déploiement).
- Mémoire : déclarée par les lectures d'un fichier de plusieurs Mo (irve:etat, 30 Mo au pic), face aux 128 Mo d'un isolat ; les autres ne la déclarent pas.
- Passage le plus chargé selon les décalages, cadences habituelles : 00:30 UTC, 84 sous-requêtes (arome:veille, partagees:liste, vigilance, web:chiffres:evenements, agendas:planifies, sans-reponse:echecs, copies:echecs, connecteurs:lecture).
- Le même, cadences les plus courtes (volcan en alerte, satellites en retard, carburants en fin de mois) : 00:30 UTC, 125 sous-requêtes (arome:veille, partagees:liste, vigilance, web:crues, web:volcan, web:chiffres:evenements, agendas:planifies, sans-reponse:echecs, copies:echecs, connecteurs:lecture).
- Sans les décalages des copies partagées (toutes dues à 00:00 UTC), cadences les plus courtes : 323 sous-requêtes à 00:00 UTC.
- Vue la plus chère : /communes/*, 82. Question la plus chère : resume_du_jour, 65. Construction la plus chère : web:chiffres:evenements, 56.

| | sous-requêtes | lectures KV | écritures KV | appels D1 | lignes D1 lues | lignes D1 écrites | CPU (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| pire passage planifié | 352 | 11 | 31 | 13 | 1 123 | 42 | 2 082 |
| tâche planifiée, par jour | 16 199 | 1 392 | 2 124 | 1 251 | 102 620 | 3 199 | 107 883 |
| tâche planifiée, par jour, cadences les plus courtes | 27 091 | 2 688 | 3 948 | 1 731 | 107 660 | 3 199 | 153 363 |
| tâche planifiée, par mois (30 jours) | 485 970 | 41 760 | 63 720 | 37 530 | 3 078 600 | 95 970 | 3 236 490 |
| tâches GitHub, par jour | 0 |  | 5 | 2 |  | 28 700 |  |
| tâches GitHub, par mois (30 jours) | 0 |  | 150 | 60 |  | 861 000 |  |

Les visites et les questions sont comptées par vue : leur total dépend du trafic.

## Tâche planifiée

| entrée | ce que c'est | cadence | décalage (UTC) | sous-requêtes | lectures KV | écritures KV | appels D1 | lignes D1 lues | lignes D1 écrites | CPU (ms) | d'où |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| arome:veille | AROME : le dernier run publié, et les grilles qu'il reste à lire | 5 min | 00:00 | 3 | 1 |  |  |  |  | 15 | mesuré |
| arome:grilles | AROME : les grilles d'un nouveau run, 40 au plus par passage, 3 de relief | 180 min | 00:00 | 43 |  | 2 |  |  |  | 60 | code |
| partagees:liste | copies partagées : la liste des clés KV, une pour les copies et celles d'après | 5 min | 00:00 | 1 |  | 1 |  |  |  |  | code |
| vigilance | copie partagée (KV) | 5 min | 00:00 | 4 |  | 1 |  |  |  | 70 | estimé |
| web:crues | copie partagée (KV) | 15 min (5 au plus court) | 00:10 | 17 | 3 | 4 |  |  |  | 50 | estimé |
| web:actualites | copie partagée (KV) | 30 min | 00:10 | 11 |  | 1 |  |  |  | 190 | mesuré |
| web:trafic | copie partagée (KV) | 30 min | 00:05 | 31 |  | 1 | 2 | 840 |  | 160 | mesuré |
| web:electricite | copie partagée (KV) | 30 min | 00:20 | 8 |  | 1 |  |  |  | 80 | mesuré |
| web:coupures | copie partagée (KV) | 30 min | 00:25 | 10 | 1 | 2 |  |  |  | 60 | mesuré |
| web:air | copie partagée (KV) | 60 min | 00:40 | 5 |  | 1 |  |  |  | 40 | mesuré |
| mer:satellites | copie partagée (KV) | 180 min (30 au plus court) | 00:55 | 11 |  | 1 |  |  |  | 110 | estimé |
| web:mer | copie partagée (KV) | 180 min | 01:15 | 14 |  | 1 |  |  |  | 110 | mesuré |
| web:calendrier | copie partagée (KV) | 360 min | 02:10 | 9 |  | 1 |  |  |  | 40 | estimé |
| seismes | copie partagée (KV) | 10 min | 00:05 | 3 |  | 1 |  |  |  | 10 | estimé |
| onf:sentiers | copie partagée (KV) | 60 min | 00:45 | 5 |  | 1 |  |  |  | 40 | estimé |
| web:volcan | copie partagée (KV) | 30 min (5 au plus court) | 00:15 | 24 | 3 | 4 | 2 | 21 |  | 110 | mesuré |
| web:courant | copie partagée (KV) | 120 min (30 au plus court) | 00:20 | 8 |  | 1 |  |  |  | 30 | mesuré |
| web:chiffres | copie partagée (KV) | 60 min | 00:50 | 26 |  | 1 | 2 | 21 |  | 60 | estimé |
| web:chiffres:evenements | copie partagée (KV) | 360 min (60 au plus court) | 00:30 | 57 |  | 1 |  |  |  | 200 | estimé |
| ens:ile | copie partagée, avec ce que les autres ont laissé | 180 min | 01:40 | 4 |  | 1 |  |  |  | 40 | mesuré |
| agendas:planifies | agendas lus par la tâche planifiée : leur copie commune (KV), lue à chaque passage, écrite après une lecture | 5 min | 00:00 | 1 | 1 |  |  |  |  |  | code |
| agendas:planifies:ecriture | agendas lus par la tâche planifiée : l'écriture de leur copie commune | 60 min | 00:00 | 1 |  | 1 |  |  |  |  | code |
| agenda:salazie | agenda lu par la tâche planifiée : Ville de Salazie | 60 min | 00:00 | 1 |  |  |  |  |  | 30 | mesuré |
| agenda:lrvb | agenda lu par la tâche planifiée : Ligue réunionnaise de volley-ball | 60 min | 00:00 | 1 |  |  |  |  |  | 30 | mesuré |
| agenda:saint_louis_actus | agenda lu par la tâche planifiée : Ville de Saint-Louis | 60 min | 00:00 | 1 |  |  |  |  |  | 30 | mesuré |
| agenda:saint_leu | agenda lu par la tâche planifiée : Ville de Saint-Leu | 60 min | 00:00 | 1 |  |  |  |  |  | 30 | mesuré |
| agenda:plaine_des_palmistes_agenda | agenda lu par la tâche planifiée : Ville de La Plaine-des-Palmistes | 60 min | 00:00 | 1 |  |  |  |  |  | 30 | mesuré |
| agenda:plaine_des_palmistes_actus | agenda lu par la tâche planifiée : Ville de La Plaine-des-Palmistes | 60 min | 00:00 | 1 |  |  |  |  |  | 30 | mesuré |
| agenda:sainte_marie_actus | agenda lu par la tâche planifiée : Ville de Sainte-Marie | 60 min | 00:00 | 1 |  |  |  |  |  | 30 | mesuré |
| agenda:salazie_actus | agenda lu par la tâche planifiée : Ville de Salazie | 60 min | 00:00 | 1 |  |  |  |  |  | 30 | mesuré |
| sans-reponse:echecs | sites sans réponse : l'état des sites relu quand une lecture échoue (D1), au plus toutes les 10 minutes par isolat, après la réponse aussi pour une vue ou une question ; une écriture de plus pour un site qui entre dans la liste | 10 min | 00:00 | 1 |  |  | 1 | 20 |  | 2 | estimé |
| copies:echecs | copies partagées : l'échec d'une copie en retard, lu avec elle et écrit après un essai manqué (KV), au plus une fois toutes les 5 minutes par copie pour tous les centres de données, seulement quand sa source ne répond pas | 5 min | 00:00 | 2 | 1 | 1 |  |  |  |  | code |
| sans-reponse:reverification | sites sans réponse : la revérification quotidienne, une lecture par site (D1 et sites), à 06:00 heure de La Réunion | 1440 min | 02:00 | 22 |  |  | 2 | 20 | 21 | 30 | estimé |
| irve:etat | bornes de recharge : la part de La Réunion du fichier national (environ 9 Mo), écrite dans KV après les autres lectures | 15 min | 00:05 | 2 |  | 1 |  |  |  | 300 | estimé |
| candhis:etat | bouées Candhis du Cerema : la dernière mesure de chaque bouée de La Réunion, une requête par type de bouée, gardée dans KV | 30 min | 00:10 | 5 | 1 | 1 |  |  |  | 10 | code |
| connecteurs:lecture | plateformes des associations (HelloAsso) : les événements publics d'une association reliée, relus toutes les 6 h, une association par passage | 5 min | 00:00 | 15 |  |  | 3 | 201 | 11 | 20 | estimé |
| propositions:purge | propositions des clubs : la purge quotidienne (D1), à 04:00 heure de La Réunion | 1440 min | 00:00 | 1 |  |  | 1 |  | 10 | 5 | estimé |

## Tâches GitHub

| entrée | ce que c'est | cadence | décalage (UTC) | sous-requêtes | lectures KV | écritures KV | appels D1 | lignes D1 lues | lignes D1 écrites | CPU (ms) | d'où |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| actions:eau | eau de l'île : la copie des avis (KV) | 360 min | 00:17 | 0 |  | 1 |  |  |  |  | code |
| actions:carburants | carburants : les prix (KV), 4 fois par jour en fin de mois | 1440 min (360 au plus court) | 03:41 | 0 |  | 1 |  |  |  |  | code |
| actions:climat | climat : les mesures de l'année en cours (D1, deux bases), une seconde fois à 09:45 UTC si besoin | 1440 min (720 au plus court) | 07:45 | 0 |  |  | 2 |  | 28 700 |  | mesuré |
| actions:deploiement | déploiement : les bases D1 vérifiées avant la mise en ligne, à chaque fusion | à chaque fusion |  | 0 |  |  | 3 | 360 |  |  | mesuré |

## Visites

| entrée | ce que c'est | cadence | décalage (UTC) | sous-requêtes | lectures KV | écritures KV | appels D1 | lignes D1 lues | lignes D1 écrites | CPU (ms) | d'où |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| / | accueil : sa météo, ses tuiles, et la plus vieille refaite après la réponse | à chaque vue |  | 80 | 10 | 2 | 2 | 840 |  | 110 | mesuré |
| /communes/* | page d'une commune : sa météo, ses tuiles, et la plus vieille refaite après la réponse | à chaque vue |  | 82 | 8 | 2 |  |  |  | 160 | mesuré |
| /aujourdhui/* | la journée d'une commune (resume_du_jour) | à chaque vue |  | 68 | 12 | 3 |  |  |  | 130 | mesuré |
| /meteo/* | la météo d'un lieu | à chaque vue |  | 54 | 2 | 2 |  |  |  | 130 | mesuré |
| /mer | la page /mer | à chaque vue |  | 23 |  |  |  |  |  | 120 | mesuré |
| /randonnees/* | une randonnée et sa trace | à chaque vue |  | 25 | 1 | 1 |  |  |  | 130 | mesuré |
| /sentiers/* | un sentier et sa trace | à chaque vue |  | 18 | 1 | 1 |  |  |  | 30 | mesuré |
| /bus/arret/* | la page d'un arrêt de bus : ses prochains départs | à chaque vue |  | 16 |  |  | 3 | 150 |  | 60 | code |
| /bus/trajet/* | le trajet d'un bus, arrêt par arrêt | à chaque vue |  | 11 |  |  | 2 | 6 |  | 30 | code |
| /coupures-eau/* | les coupures d'une commune | à chaque vue |  | 29 | 1 | 1 |  |  |  | 70 | mesuré |
| /enfants/* | les lieux pour les enfants d'une commune, sur sa carte | à chaque vue |  | 37 |  |  |  |  |  | 350 | code |
| /feux | la page /feux | à chaque vue |  | 22 | 1 | 1 |  |  |  | 90 | mesuré |
| /ecoles-cyclone | la page /ecoles-cyclone | à chaque vue |  | 14 | 1 | 1 |  |  |  | 50 | mesuré |
| /carburants | la page /carburants | à chaque vue |  | 13 |  |  |  |  |  | 30 | mesuré |
| /associations | l'espace des associations et leurs propositions (D1) | à chaque vue |  | 10 |  |  |  |  |  | 40 | mesuré |
| /associations/relier | relier sa plateforme : les clés vérifiées par HelloAsso, puis la connexion écrite (D1) et l'e-mail | à chaque vue |  | 14 |  |  | 2 | 2 |  | 40 | code |
| /associations/connexion/* | le lien reçu par e-mail : confirmer ou retirer la connexion (D1), et l'e-mail qui le dit | à chaque vue |  | 14 |  |  | 4 | 4 |  | 30 | code |
| /associations/evenements.* | les flux ouverts des événements proposés (JSON, ICS) : la copie du centre de données, sinon les propositions publiées (D1), 5 minutes | à chaque vue |  | 3 |  |  | 1 | 100 |  | 20 | estimé |
| /sites-sans-reponse | les sites publics sans réponse (D1), avec la vigilance et la version de l'en-tête | à chaque vue |  | 9 |  |  | 2 | 21 |  | 40 | code |
| /chiffres | rundata.re en chiffres : la copie de ses comptes, avec la vigilance et la version de l'en-tête | à chaque vue |  | 9 | 1 |  |  |  |  | 40 | code |
| * | toute autre adresse : la vigilance et la version, lues pour l'en-tête | à chaque vue |  | 7 |  |  |  |  |  | 70 | mesuré |
| /meteo | la page /meteo | à chaque vue |  | 45 | 2 | 2 |  |  |  | 80 | mesuré |
| /volcan | la page /volcan | à chaque vue |  | 55 | 4 | 3 | 2 | 21 |  | 60 | mesuré |
| /air | la page /air | à chaque vue |  | 14 | 1 |  |  |  |  | 40 | mesuré |
| /electricite | la page /electricite | à chaque vue |  | 17 | 1 |  |  |  |  | 30 | mesuré |
| /calendrier | la page /calendrier | à chaque vue |  | 18 | 1 |  |  |  |  | 40 | mesuré |
| /bus | la page /bus | à chaque vue |  | 45 |  |  | 2 | 840 |  | 190 | mesuré |
| /trafic | la page /trafic | à chaque vue |  | 51 | 1 |  | 2 | 840 |  | 270 | mesuré |
| /velos | la page /velos | à chaque vue |  | 14 |  |  |  |  |  | 50 | mesuré |
| /bornes | la page /bornes | à chaque vue |  | 12 |  |  |  |  |  | 40 | mesuré |
| /eau | la page /eau | à chaque vue |  | 13 | 1 | 1 |  |  |  | 30 | mesuré |
| /randonnees | la page /randonnees | à chaque vue |  | 24 | 1 | 1 |  |  |  | 210 | mesuré |
| /sentiers | la page /sentiers | à chaque vue |  | 21 | 1 | 1 |  |  |  | 60 | mesuré |
| /secheresse | la page /secheresse | à chaque vue |  | 12 |  |  |  |  |  | 70 | mesuré |
| /coupures-eau | la page /coupures-eau | à chaque vue |  | 22 | 2 | 1 |  |  |  | 100 | mesuré |
| /defibrillateurs | la page /defibrillateurs ; « Autour de moi » charge au clic la liste compacte (public/dae/), servie par Cloudflare avant le Worker : 0 Worker, 0 KV, 0 D1 | à chaque vue |  | 6 |  |  |  |  |  | 40 | mesuré |
| /sport | la page /sport | à chaque vue |  | 42 |  |  |  |  |  | 120 | mesuré |
| /decheteries | la page /decheteries | à chaque vue |  | 12 |  |  |  |  |  | 30 | mesuré |
| /cyclones | la page /cyclones | à chaque vue |  | 29 | 1 | 1 |  |  |  | 50 | mesuré |
| /crues | la page /crues | à chaque vue |  | 36 | 4 | 3 |  |  |  | 120 | estimé |
| /historique | la page /historique | à chaque vue |  | 15 |  |  |  |  |  | 70 | mesuré |
| /evenements | la page /evenements | à chaque vue |  | 54 |  |  |  |  |  | 200 | mesuré |
| /evenements/ce-week-end | comme /evenements, une partie de sa copie | à chaque vue |  | 36 |  |  |  |  |  | 230 | mesuré |
| /evenements/concerts | comme /evenements, une partie de sa copie | à chaque vue |  | 36 |  |  |  |  |  | 230 | mesuré |
| /actualites | la page /actualites | à chaque vue |  | 20 | 1 |  |  |  |  | 160 | mesuré |
| /enfants | la page /enfants | à chaque vue |  | 37 |  |  |  |  |  | 350 | mesuré |

## Questions

| entrée | ce que c'est | cadence | décalage (UTC) | sous-requêtes | lectures KV | écritures KV | appels D1 | lignes D1 lues | lignes D1 écrites | CPU (ms) | d'où |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| resume_du_jour | l'outil resume_du_jour | à chaque vue |  | 65 | 3 | 3 |  |  |  | 130 | mesuré |
| meteo_actuelle | l'outil meteo_actuelle | à chaque vue |  | 36 |  |  |  |  |  | 120 | mesuré |
| evenements | l'outil evenements | à chaque vue |  | 33 |  |  |  |  |  | 190 | mesuré |
| sport | l'outil sport | à chaque vue |  | 33 |  |  |  |  |  | 160 | mesuré |
| volcan_seismes | l'outil volcan_seismes | à chaque vue |  | 42 | 3 | 3 | 2 | 21 |  | 90 | mesuré |
| fiche_terrain | l'outil fiche_terrain | à chaque vue |  | 36 |  |  |  |  |  | 80 | estimé |
| prevision_meteo | l'outil prevision_meteo | à chaque vue |  | 22 | 1 | 1 |  |  |  | 100 | mesuré |
| qualite_eau | l'outil qualite_eau | à chaque vue |  | 17 | 1 | 1 |  |  |  | 90 | mesuré |
| temperature_mer | l'outil temperature_mer | à chaque vue |  | 14 |  |  |  |  |  | 50 | mesuré |
| transports | l'outil transports | à chaque vue |  | 13 |  |  | 2 | 840 |  | 80 | mesuré |
| cyclones | l'outil cyclones | à chaque vue |  | 15 | 1 | 1 |  |  |  | 70 | mesuré |
| actualites | l'outil actualites | à chaque vue |  | 10 |  |  |  |  |  | 180 | mesuré |
| historique_meteo | l'outil historique_meteo | à chaque vue |  | 10 |  |  | 3 | 300 |  | 60 | mesuré |
| sentiers_randonnee | l'outil sentiers_randonnee | à chaque vue |  | 12 | 1 | 1 |  |  |  | 60 | mesuré |
| vigilance_meteo | l'outil vigilance_meteo | à chaque vue |  | 12 | 1 | 1 |  |  |  | 50 | mesuré |
| coupures_eau | l'outil coupures_eau | à chaque vue |  | 11 | 1 | 1 |  |  |  | 110 | mesuré |
| electricite | l'outil electricite | à chaque vue |  | 9 |  |  |  |  |  | 60 | mesuré |
| crues_rivieres | l'outil crues_rivieres | à chaque vue |  | 15 | 3 | 3 |  |  |  | 30 | mesuré |
| calendrier | l'outil calendrier | à chaque vue |  | 7 |  |  |  |  |  | 70 | mesuré |
| velos_libre_service | l'outil velos_libre_service | à chaque vue |  | 6 |  |  |  |  |  | 30 | mesuré |
| maree | l'outil maree | à chaque vue |  | 6 |  |  |  |  |  | 130 | mesuré |
| annuaire_services_publics | l'outil annuaire_services_publics | à chaque vue |  | 3 |  |  |  |  |  | 20 | mesuré |
| restrictions_eau | l'outil restrictions_eau | à chaque vue |  | 3 |  |  |  |  |  | 60 | mesuré |
| bornes_recharge | l'outil bornes_recharge | à chaque vue |  | 3 |  |  |  |  |  | 50 | mesuré |
| qualite_air | l'outil qualite_air | à chaque vue |  | 3 |  |  |  |  |  | 50 | mesuré |
| defibrillateurs | l'outil defibrillateurs | à chaque vue |  | 0 |  |  |  |  |  | 70 | mesuré |
| donner_avis | l'outil donner_avis | à chaque vue |  | 1 |  |  | 1 | 5 | 3 | 60 | mesuré |
| sources_donnees | l'outil sources_donnees | à chaque vue |  | 2 |  |  |  |  |  | 40 | code |
| sites_sans_reponse | l'outil sites_sans_reponse | à chaque vue |  | 2 |  |  | 2 | 21 |  | 30 | code |

## Sources lues

Les fichiers qui lisent un site (par src/http.ts), atteints par les imports de chaque entrée.

| entrée | sources |
|---|---|
| arome:veille | providers/arome, providers/mf-auth |
| arome:grilles | providers/arome, providers/mf-auth |
| vigilance | providers/mf-auth, providers/vigilance |
| web:crues | providers/vigicrues |
| web:actualites | providers/actualites, providers/avis-eau |
| web:trafic | providers/actualites, providers/avis-eau, providers/calendrier, providers/gtfsrt |
| web:electricite | providers/avis-eau, providers/coupures-courant, providers/edf |
| web:coupures | providers/avis-eau, providers/eaupotable |
| web:air | providers/atmo |
| mer:satellites | providers/acspo, providers/modis |
| web:mer | providers/acspo, providers/arome, providers/ensemble, providers/houle, providers/mf-auth, providers/modis, providers/openmeteo, providers/uv |
| web:calendrier | providers/calendrier |
| seismes | providers/seismes |
| onf:sentiers | providers/sentiers |
| web:volcan | providers/actualites, providers/agenda, providers/avis-eau, providers/ovpf-pdf, providers/prefecture, providers/salles, providers/seismes, providers/sentiers, providers/sport, providers/traces, providers/volcan |
| web:courant | providers/avis-eau, providers/coupures-courant |
| web:chiffres | providers/agenda, providers/avis-eau, providers/metar, providers/meteofrance, providers/mf-auth, providers/pioupiou, providers/radar, providers/salles, providers/sentiers, providers/sport, providers/velos |
| web:chiffres:evenements | providers/actualites, providers/agenda, providers/avis-eau, providers/salles, providers/sport-avis, providers/sport |
| ens:ile | providers/ensemble |
| agenda:salazie | providers/agenda, providers/avis-eau, providers/salles, providers/sport |
| agenda:lrvb | providers/agenda, providers/avis-eau, providers/salles, providers/sport |
| agenda:saint_louis_actus | providers/agenda, providers/avis-eau, providers/salles, providers/sport |
| agenda:saint_leu | providers/agenda, providers/avis-eau, providers/salles, providers/sport |
| agenda:plaine_des_palmistes_agenda | providers/agenda, providers/avis-eau, providers/salles, providers/sport |
| agenda:plaine_des_palmistes_actus | providers/agenda, providers/avis-eau, providers/salles, providers/sport |
| agenda:sainte_marie_actus | providers/agenda, providers/avis-eau, providers/salles, providers/sport |
| agenda:salazie_actus | providers/agenda, providers/avis-eau, providers/salles, providers/sport |
| sans-reponse:echecs | providers/agenda, providers/avis-eau, providers/salles, providers/sport |
| sans-reponse:reverification | providers/agenda, providers/avis-eau, providers/salles, providers/sport |
| irve:etat | providers/irve |
| candhis:etat | providers/candhis |
| connecteurs:lecture | connecteurs/helloasso |
| / | providers/arome, providers/ensemble, providers/feux, providers/metar, providers/meteofrance, providers/mf-auth, providers/openmeteo, providers/pioupiou, providers/radar, providers/uv, providers/vigilance |
| /communes/* | providers/acspo, providers/arome, providers/ensemble, providers/feux, providers/houle, providers/metar, providers/meteofrance, providers/mf-auth, providers/modis, providers/openmeteo, providers/pioupiou, providers/radar, providers/uv, providers/vigilance |
| /aujourdhui/* | providers/acspo, providers/actualites, providers/agenda, providers/annuaire, providers/arome, providers/atmo, providers/avis-eau, providers/baignades, providers/calendrier, providers/carburants, providers/coupures-courant, providers/cyclones, providers/eaupotable, providers/edf, providers/ensemble, providers/feux, providers/gtfsrt, providers/houle, providers/irve, providers/maregraphes, providers/metar, providers/meteofrance, providers/mf-auth, providers/modis, providers/openmeteo, providers/pioupiou, providers/prefecture, providers/radar, providers/salles, providers/seismes, providers/sentiers, providers/sport-avis, providers/sport, providers/tco, providers/terrain, providers/traces, providers/uv, providers/velos, providers/vigicrues, providers/vigieau, providers/vigilance, providers/volcan |
| /meteo/* | providers/acspo, providers/arome, providers/ensemble, providers/feux, providers/houle, providers/metar, providers/meteofrance, providers/mf-auth, providers/modis, providers/openmeteo, providers/pioupiou, providers/radar, providers/uv, providers/vigilance |
| /mer | providers/acspo, providers/arome, providers/ensemble, providers/houle, providers/maregraphes, providers/mf-auth, providers/modis, providers/openmeteo, providers/uv |
| /randonnees/* | providers/feux, providers/sentiers, providers/traces |
| /sentiers/* | providers/feux, providers/sentiers, providers/traces |
| /bus/arret/* | providers/calendrier, providers/gtfsrt |
| /bus/trajet/* | providers/calendrier, providers/gtfsrt |
| /coupures-eau/* | providers/avis-eau, providers/eaupotable |
| /enfants/* | providers/actualites, providers/agenda, providers/avis-eau, providers/salles, providers/sport-avis, providers/sport |
| /feux | providers/feux |
| /ecoles-cyclone | providers/feux, providers/mf-auth, providers/vigilance |
| /carburants | providers/carburants |
| /associations | providers/acspo, providers/actualites, providers/agenda, providers/annuaire, providers/arome, providers/atmo, providers/avis-eau, providers/baignades, providers/calendrier, providers/carburants, providers/coupures-courant, providers/cyclones, providers/eaupotable, providers/edf, providers/ensemble, providers/feux, providers/gtfsrt, providers/houle, providers/irve, providers/maregraphes, providers/metar, providers/meteofrance, providers/mf-auth, providers/modis, providers/openmeteo, providers/pioupiou, providers/prefecture, providers/radar, providers/salles, providers/seismes, providers/sentiers, providers/sport-avis, providers/sport, providers/tco, providers/terrain, providers/traces, providers/uv, providers/velos, providers/vigicrues, providers/vigieau, providers/vigilance, providers/volcan, web/propositions |
| /associations/relier | connecteurs/helloasso, providers/acspo, providers/actualites, providers/agenda, providers/annuaire, providers/arome, providers/atmo, providers/avis-eau, providers/baignades, providers/calendrier, providers/carburants, providers/coupures-courant, providers/cyclones, providers/eaupotable, providers/edf, providers/ensemble, providers/feux, providers/gtfsrt, providers/houle, providers/irve, providers/maregraphes, providers/metar, providers/meteofrance, providers/mf-auth, providers/modis, providers/openmeteo, providers/pioupiou, providers/prefecture, providers/radar, providers/salles, providers/seismes, providers/sentiers, providers/sport-avis, providers/sport, providers/tco, providers/terrain, providers/traces, providers/uv, providers/velos, providers/vigicrues, providers/vigieau, providers/vigilance, providers/volcan, web/propositions |
| /associations/connexion/* | connecteurs/helloasso, providers/acspo, providers/actualites, providers/agenda, providers/annuaire, providers/arome, providers/atmo, providers/avis-eau, providers/baignades, providers/calendrier, providers/carburants, providers/coupures-courant, providers/cyclones, providers/eaupotable, providers/edf, providers/ensemble, providers/feux, providers/gtfsrt, providers/houle, providers/irve, providers/maregraphes, providers/metar, providers/meteofrance, providers/mf-auth, providers/modis, providers/openmeteo, providers/pioupiou, providers/prefecture, providers/radar, providers/salles, providers/seismes, providers/sentiers, providers/sport-avis, providers/sport, providers/tco, providers/terrain, providers/traces, providers/uv, providers/velos, providers/vigicrues, providers/vigieau, providers/vigilance, providers/volcan, web/propositions |
| /associations/evenements.* |  |
| /sites-sans-reponse | providers/agenda, providers/avis-eau, providers/salles, providers/sport |
| /meteo | providers/arome, providers/ensemble, providers/feux, providers/metar, providers/meteofrance, providers/mf-auth, providers/openmeteo, providers/pioupiou, providers/radar, providers/uv, providers/vigilance |
| /volcan | providers/actualites, providers/agenda, providers/avis-eau, providers/prefecture, providers/salles, providers/seismes, providers/sentiers, providers/sport, providers/traces, providers/volcan |
| /air | providers/atmo |
| /electricite | providers/avis-eau, providers/coupures-courant, providers/edf |
| /calendrier | providers/calendrier |
| /bus | providers/calendrier, providers/gtfsrt |
| /trafic | providers/actualites, providers/avis-eau, providers/calendrier, providers/gtfsrt |
| /velos | providers/velos |
| /bornes | providers/irve |
| /eau | providers/avis-eau, providers/baignades, providers/eaupotable |
| /randonnees | providers/feux, providers/sentiers, providers/traces |
| /sentiers | providers/feux, providers/sentiers, providers/traces |
| /secheresse | providers/vigieau |
| /coupures-eau | providers/avis-eau, providers/eaupotable |
| /defibrillateurs |  |
| /sport | providers/agenda, providers/avis-eau, providers/salles, providers/sport-avis, providers/sport |
| /decheteries | providers/tco |
| /cyclones | providers/actualites, providers/avis-eau, providers/cyclones, providers/feux, providers/mf-auth, providers/prefecture, providers/vigilance |
| /crues | providers/actualites, providers/avis-eau, providers/vigicrues |
| /historique |  |
| /evenements | providers/actualites, providers/agenda, providers/avis-eau, providers/salles, providers/sport-avis, providers/sport |
| /evenements/ce-week-end | providers/actualites, providers/agenda, providers/avis-eau, providers/salles, providers/sport-avis, providers/sport |
| /evenements/concerts | providers/actualites, providers/agenda, providers/avis-eau, providers/salles, providers/sport-avis, providers/sport |
| /actualites | providers/actualites, providers/avis-eau |
| /enfants | providers/actualites, providers/agenda, providers/avis-eau, providers/salles, providers/sport-avis, providers/sport |
| resume_du_jour | providers/acspo, providers/actualites, providers/agenda, providers/annuaire, providers/arome, providers/atmo, providers/avis-eau, providers/baignades, providers/calendrier, providers/carburants, providers/coupures-courant, providers/cyclones, providers/eaupotable, providers/edf, providers/ensemble, providers/feux, providers/gtfsrt, providers/houle, providers/irve, providers/maregraphes, providers/metar, providers/meteofrance, providers/mf-auth, providers/modis, providers/openmeteo, providers/pioupiou, providers/prefecture, providers/radar, providers/salles, providers/seismes, providers/sentiers, providers/sport-avis, providers/sport, providers/tco, providers/terrain, providers/traces, providers/uv, providers/velos, providers/vigicrues, providers/vigieau, providers/vigilance, providers/volcan |
| meteo_actuelle | providers/metar, providers/meteofrance, providers/mf-auth, providers/pioupiou, providers/radar |
| evenements | providers/actualites, providers/agenda, providers/avis-eau, providers/salles, providers/sport-avis, providers/sport |
| sport | providers/agenda, providers/avis-eau, providers/salles, providers/sport-avis, providers/sport |
| volcan_seismes | providers/actualites, providers/agenda, providers/avis-eau, providers/prefecture, providers/salles, providers/seismes, providers/sentiers, providers/sport, providers/traces, providers/volcan |
| fiche_terrain | providers/terrain |
| prevision_meteo | providers/arome, providers/ensemble, providers/mf-auth, providers/openmeteo, providers/uv |
| qualite_eau | providers/avis-eau, providers/baignades, providers/eaupotable |
| temperature_mer | providers/acspo, providers/arome, providers/ensemble, providers/houle, providers/mf-auth, providers/modis, providers/openmeteo, providers/uv |
| transports | providers/calendrier, providers/gtfsrt |
| cyclones | providers/actualites, providers/avis-eau, providers/cyclones, providers/feux, providers/mf-auth, providers/prefecture, providers/vigilance |
| actualites | providers/actualites, providers/avis-eau |
| historique_meteo |  |
| sentiers_randonnee | providers/feux, providers/sentiers, providers/traces |
| vigilance_meteo | providers/feux, providers/mf-auth, providers/vigilance |
| coupures_eau | providers/avis-eau, providers/eaupotable |
| electricite | providers/avis-eau, providers/coupures-courant, providers/edf |
| crues_rivieres | providers/vigicrues |
| calendrier | providers/calendrier |
| velos_libre_service | providers/velos |
| maree | providers/arome, providers/ensemble, providers/maregraphes, providers/mf-auth, providers/openmeteo, providers/uv |
| annuaire_services_publics | providers/annuaire, providers/carburants, providers/tco |
| restrictions_eau | providers/vigieau |
| bornes_recharge | providers/irve |
| qualite_air | providers/atmo |
| defibrillateurs |  |
| sites_sans_reponse | providers/agenda, providers/avis-eau, providers/salles, providers/sport |
