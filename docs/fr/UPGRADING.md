# Migrer un jeu de v2 vers v3

La v3 casse volontairement une fois le contrat d'écriture afin de rendre ensuite les sauvegardes durables. Faire la
migration sur une branche, garder une sauvegarde v2 représentative et ne pas traduire ni réordonner le contenu avant
d'avoir posé les ids ci-dessous.

## 1. Établir la référence v2

Sur le dernier commit v2, exporter des sauvegardes aux checkpoints importants et garder une session complète. Noter :

```bash
GAME=<id> npm run validate
GAME=<id> npm run solve
GAME=<id> npm test
```

Ne jamais committer dans ce dépôt public le contenu du jeu privé ni les sauvegardes exportées des joueurs.

## 2. Activer le schéma v3

Ajouter `schemaVersion: 3` à `defineGame({...})`. `compileGame` clone et normalise la source ; la valeur v3 compilée
est figée. Une intégration ne doit donc plus dépendre de `engine.game === source` ni la modifier après construction.

Lancer `GAME=<id> npm run validate`, puis corriger chaque erreur d'id stable :

- chaque `Rule` de lieu ou globale : `id` ;
- chaque `TalkTopic` : `id` ;
- chaque `Choice` : `id` (surtout les choix `once`) ;
- chaque `EventRule` de lieu ou globale : `id` ;
- chaque bloc persistant `{ once }`, `{ nth }`, `{ cycle }`, `{ random }` : `id` ;
- chaque script : une valeur `stepIds` par commande de premier niveau, dans le même ordre.

Choisir des ids sémantiques (`garde_manger.ouvrir`, `grandmere.demander_cle`, `horloge.attendre`), jamais des numéros
ni du texte traduit. Ils sont uniques dans tout le jeu. Les règles de sortie générées reçoivent automatiquement des
ids déterministes.

## 3. Migrer les sauvegardes volontairement

Le navigateur stocke une enveloppe `web-scumm-save` de schéma 3 dans IndexedDB. Au premier lancement v3, l'ancienne
autosauvegarde localStorage `<jeu>.save` est importée une fois et supprimée seulement après relecture de l'écriture.
Les emplacements manuels restent importables.

Incrémenter `saveVersion` pour tout changement d'état et fournir une `Migration` par étape entière. En plus des champs
v2, la v3 sait migrer :

```ts
migrations: [{
  from: 2,
  renameCounter: { 'maison:on3.0': 'garde_manger.premiere_ouverture' },
  renameSeen: { 'topic.maison/grandmere[0]': 'topic.grandmere.demander_cle' },
  renameScript: { vieille_horloge: 'horloge' },
  renameScriptStep: { horloge: { 'step.1': 'carillon' } },
  renamePlayer: { enfant: 'laverne' },
  renameCharacter: { ancienne_grandmere: 'grandmere' },
  dropCounter: ['gag_temporaire'],
  dropSeen: ['choix_supprime'],
  dropScript: ['ronde_supprimee'],
}],
```

Ne convertir une ancienne clé positionnelle de compteur, sujet ou script que si le contenu v2 et son sens sont connus.
Il n'existe aucune conversion universelle sûre après un réordonnancement ou une traduction. Une référence facultative
périmée non mappée est élaguée avec un avertissement visible ; JSON mal formé, autre jeu, lieu courant absent ou joueur
actif inconnu sont refusés sans remplacer la session courante.

## 4. Mettre à jour traductions et mini-jeux

Lancer `npm run i18n -- extract --lang <xx>` pour chaque langue livrée. La v3 extrait aussi les libellés/mots de liaison
des verbes et les chemins déclarés dans `textParams` par chaque mini-jeu. Lancer ensuite `npm run i18n -- status` et
traduire toute nouvelle entrée.

Un mini-jeu personnalisé doit déclarer `required` et `textParams` afin que validation et traduction comprennent ses
paramètres. Les ids d'assets gardent la convention `planche/case` et sont découverts par les outils d'assets.

## 5. Mettre à jour les commandes de développement et de CI

- `npm run dev` et `npm run studio` sont limités à la boucle locale.
- Utiliser `dev:lan` / `studio:lan` depuis un téléphone et ouvrir l'URL avec jeton affichée.
- `npm test` est la suite Node ; `npm run test:assets` est la suite d'assets adossée à Python.
- `npm run build` exige validation et chemin gagnant, pas une preuve illimitée de l'espace d'états.
- `npm run prove:game` prouve graphes global et par chapitre et échoue sur softlock ou troncature.
- `npm run release-check` inclut prérequis, build, preuve exhaustive et audit des dépendances.

Ne pas activer de réduction d'ordre partiel en mode preuve tant que son équivalence avec l'exploration de référence
n'est pas démontrée pour la classe de jeux concernée.

## 6. Vérifier le jeu migré

```bash
GAME=<id> npm run doctor
GAME=<id> npm run build
GAME=<id> npm run prove:game
GAME=<id> npm run e2e -- http://127.0.0.1:5173/ --prod
```

Charger chaque sauvegarde v2 représentative et vérifier lieu, joueur actif, inventaires, choix persistants et étape de
script. Dans un fixture de test, réordonner une règle, un sujet, un choix et une étape de script : la même sauvegarde v3
doit garder son sens. Enfin, tester la PWA de production en ligne, hors ligne dans les lieux en cache et pendant une
mise à jour. Les lieux jamais visités ne sont pas garantis hors ligne.
