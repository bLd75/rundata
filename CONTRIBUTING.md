# Contribuer

Merci de votre intérêt pour rundata.re. Le projet veut faire avancer le numérique à La Réunion, et toute aide compte : une source de données publique à ajouter, une erreur à corriger, une question qui reste sans bonne réponse, une page à améliorer.

## Sans coder

- Une erreur, une idée, une source : ouvrez un ticket (onglet **Issues**) ou une discussion (onglet **Discussions**), ou écrivez à contact@rundata.re.
- Une faille de sécurité : en privé, voir [SECURITY.md](SECURITY.md).

## En codant

1. Pour un changement important, ouvrez d'abord un ticket : on en parle avant que vous y passiez du temps.
2. En local (Node ≥ 20) : `npm install`, puis `npm run dev:http`. `npm test` lance les tests, sans réseau ; `npm run typecheck` vérifie les types.
3. Ouvrez une pull request et remplissez le modèle proposé.

Quelques règles :
- une nouvelle source n'entre que si sa licence permet la reprise, et elle est citée dans `sources_donnees` et le README ;
- une mesure n'est jamais mélangée à une prévision, et chaque valeur dit sa source et son heure ;
- aucun secret ni adresse personnelle dans les fichiers.

Chaque pull request est relue avant d'être fusionnée, et une pull request fusionnée part en ligne sur rundata.re. Le code est sous licence MIT : en contribuant, vous acceptez que votre contribution le soit aussi.

## English

Contributions are welcome: open an issue or a discussion, or a pull request (`npm install`, `npm test`, `npm run typecheck`). Every pull request is reviewed before it is merged; merged code goes live on rundata.re. Code is MIT-licensed, and so are contributions.
