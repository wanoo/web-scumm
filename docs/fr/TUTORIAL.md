# Une première pièce en quinze minutes

La méthode, de bout en bout, est [WORKFLOW](WORKFLOW.md) ; le format, champ par champ, est
[CONTENT_GUIDE](CONTENT_GUIDE.md). Cette page est le chemin le plus court de rien à une pièce jouable sur votre
téléphone, avec les fichiers touchés nommés à chaque étape. Quinze minutes avec un checkout de ce dépôt ; les mêmes
étapes valent dans un projet de jeu créé avec `web-scumm create` ([PACKAGE](PACKAGE.md)), où `games/<id>/` est
`game/`.

## 1. Un jeu depuis le modèle (une minute)

```bash
npm install
npm run new-game lamp "The Lamp"   # games/lamp depuis games/_template, choisi comme jeu courant (.cache/game)
npm run assets                     # les images de remplacement dans public/assets
npm run dev                        # http://localhost:5173/ : un jardin, un seau, un portail
```

Le modèle est un jeu complet d'une pièce : prendre le seau, l'utiliser sur le portail, fin. Tout ce que vous
écrirez est une variation de ce qui s'y trouve déjà.

## 2. Lire la pièce que vous allez changer (deux minutes)

`games/lamp/rooms/start.ts` est toute la pièce. Lisez-la de haut en bas : `props` (les choses qui ont une image),
`hotspots` (des endroits du décor), `look` (une ligne, ou trois qui tournent, pour chacun), `on` (les règles : un
verbe, une cible, une condition, ce qui se passe), `hints` (ce que le héros dit quand on lui demande, jusqu'à ce
qu'un drapeau soit posé), `onEnter`. La géométrie n'est pas là : `games/lamp/layout/start.json` dit où les choses se
tiennent, et seuls le Studio ou l'éditeur de placement l'écrivent.

## 3. Ajouter un accessoire et sa règle (cinq minutes)

Ajoutez une lampe au jardin. Dans `rooms/start.ts` :

```ts
props: {
  bucket: { name: 'bucket', img: 'starter/items/bucket' },
  lamp: { name: 'lamp', img: 'starter/items/bucket', states: { off: 'starter/items/bucket', on: 'starter/items/bucket' } },
},
look: {
  // …
  lamp: ['A garden lamp. Off.', 'Still off.', 'It is thinking about it.'],
},
on: [
  // …
  { id: 'start.light-lamp', verb: 'use', a: 'lamp', if: '!lamp_on',
    do: [{ set: 'lamp_on' }, { prop: ['lamp', 'on'] }, 'There. Light.'] },
],
```

L'image est celle du seau pour l'instant (`npm run prompts` écrit le prompt d'une vraie, et l'onglet Assets du
Studio découpe ce que vous générez). Une règle est un verbe, une cible, une condition et une liste de commandes ; une
chaîne dans `do` est une ligne que le héros dit. `{ prop: ['lamp', 'on'] }` change l'état de l'accessoire,
`{ set: 'lamp_on' }` s'en souvient dans la sauvegarde.

## 4. La placer (deux minutes)

```bash
npm run studio                     # le Studio s'ouvre ; onglet Rooms, « start »
```

La lampe n'a pas encore de place, le Studio la montre à l'endroit par défaut. Glissez-la où vous voulez, glissez sa
hauteur, enregistrez : `layout/start.json` gagne une entrée `lamp`. Ne tapez jamais de coordonnées à la main ;
l'éditeur et le Studio sont là pour ça.

## 5. Raconter d'abord, puis vérifier (trois minutes)

`games/lamp/storyboard.json` est la source de vérité du texte : ajoutez un panneau au tableau du jardin (`"action":
"Use lamp"`, la ligne que le héros dit). L'onglet Storyboard montre ce qui est implémenté et ce qui ne l'est pas ;
l'onglet Check lance le validateur et le solveur après chaque enregistrement. Depuis le terminal :

```bash
npm run validate   # un accessoire sans ligne look, un drapeau que rien ne lit, une règle que personne n'atteint : dit ici
npm run solve      # un chemin de Nouvelle partie à la fin, imprimé pas à pas ; « softlock » si le joueur peut se bloquer
npm test           # les tests du moteur et le parcours de votre jeu (games/lamp/tests/game.test.ts)
```

Une règle dont le solveur n'a jamais besoin n'est pas un bug (la lampe est une décoration), mais `npm run lint` vous
dit que c'en est une.

## 6. Y jouer sur votre téléphone (deux minutes)

```bash
npm run dev:lan                    # le serveur de dev sur votre réseau ; ouvrez l'URL imprimée sur le téléphone, en paysage
```

Touchez la lampe avec Utiliser. La ligne s'affiche, l'accessoire change, la sauvegarde s'en souvient au rechargement.
C'est la boucle : écrire une règle, la placer, vérifier, jouer. Ensuite : [CONTENT_GUIDE](CONTENT_GUIDE.md) pour
chaque champ, [CLASSICS](CLASSICS.md) pour vingt mécaniques célèbres écrites avec, [STUDIO](STUDIO.md) pour l'outil,
[WORKFLOW](WORKFLOW.md) pour un jeu entier de la première idée à la release.
