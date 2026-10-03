# Les classiques : les mécaniques célèbres du genre, écrites avec ce moteur

*Version anglaise : [docs/en/CLASSICS.md](../en/CLASSICS.md). Écrit pour la v2.1 ; chaque entrée « natif » ci-dessous
est le vrai DSL, et cinq d'entre elles sont jouées par le moteur et prouvées par le solveur dans `tests/classics.test.ts`
(fixtures dans `tests/fixtures/classics.ts`).*

Avant de demander une nouvelle primitive, regarder ici : l'essentiel de ce qui a rendu les jeux LucasArts mémorables est
une combinaison de règles, de flags, de scripts et d'événements que le moteur a déjà. Les verdicts :

| Verdict | Sens |
|---|---|
| **natif** | Le DSL tel quel, quelques lignes ; le validateur et le solveur le comprennent. |
| **faisable** | Le DSL le fait, avec un détour ou une convention à connaître. |
| **custom** | Un mini-jeu du registre ou une commande `custom` : le moteur l'exécute, le solveur ne connaît que ses effets déclarés. |
| **hors champ** | Le moteur ne le fera pas, volontairement. |

## Monkey Island

### Le combat d'insultes — natif (testé)

Les insultes s'apprennent auprès d'un pirate : chacune est un flag. Le duel est un sujet dont les `choice` ne proposent
que les répliques connues ; les bonnes comptent des victoires, le seuil termine le duel. Pas de mini-jeu : le combat
*est* une conversation.

```ts
talk: {
  thug: [{ topic: 'Battons-nous !', if: '!learned_farmer', do: [{ say: ['thug', 'Tu te bats comme un fermier !'] }, { set: 'learned_farmer' }] }],
  master: [{ topic: 'Je te défie !', do: [
    { say: ['master', 'Tu te bats comme un fermier !'] },
    { choice: [
      { text: 'Comme c\'est approprié, tu te bats comme une vache.', if: 'learned_farmer', do: [{ inc: 'wins' }] },
      { text: 'Ah ouais ?', do: [{ say: ['master', 'Pathétique.'] }] } ] },
    { if: { flag: 'wins', gte: 2 }, then: [{ set: 'master_beaten' }], else: [{ set: ['wins', 0] }] } ] }],
}
```

Le solveur essaie chaque réponse d'un `choice` : il prouve que le duel se gagne, et seulement une fois les insultes apprises.

### Les trois épreuves, dans n'importe quel ordre — natif

Trois flags, une règle qui exige les trois, et un checkpoint de chapitre dont les `goals` les listent :
`checkpoints: { pirate: { room: 'bar', goals: ['trial_sword', 'trial_theft', 'trial_treasure'] } }`.
`npm run solve -- --chapters` prouve chaque épreuve atteignable depuis le checkpoint précédent, quel que soit l'ordre.

### Marchander avec le vendeur de bateaux d'occasion — natif (testé)

Un flag numérique *descend* ; un sujet s'ouvre sous un seuil, un autre se ferme.

```ts
start: { room: 'yard', inventory: ['coins'], flags: { price: 8000 } },
talk: { stan: [
  { topic: 'C\'est trop cher.', if: { all: ['asked', { flag: 'price', gte: 6000 }] }, do: [{ inc: 'price', by: -1000 }, { say: ['stan', 'Bon, 1000 de moins !'] }] },
  { topic: 'Marché conclu.', if: { all: ['asked', { flag: 'price', lt: 5001 }, { has: 'coins' }] }, do: [{ lose: 'coins' }, { set: 'ship_bought' }] } ] }
```

Le solveur garde la valeur exacte d'un compteur qui baisse (il ne borne que ceux qui montent).

### La chope de grog qui fond — natif (testé)

Un script du monde avec un `while` : tant que le héros porte la chope, le temps la ronge. Il faut se dépêcher, ou la remplir à nouveau.

```ts
scripts: [{ id: 'mug_melts', loop: true, while: { has: 'mug_grog' },
  do: [{ wait: 8000 }, { gain: 'mug_holey' }, { lose: 'mug_grog' }, { toast: 'La chope a fondu.' }] }]
```

Donner la nouvelle chope *avant* de retirer l'ancienne : `while` est vérifié avant chaque commande. Le solveur joue
« laisser fondre » comme l'un des choix et trouve quand même le chemin où le héros arrive à temps.

### Suivre le boutiquier jusqu'au maître d'épée — natif

Un script attend que le héros le rattrape, salle après salle :

```ts
scripts: [{ id: 'keeper_leads', do: [
  { waitEvent: 'ask_master' }, { moveActor: ['keeper', 'path'] }, { waitUntil: { room: 'path' } },
  { moveActor: ['keeper', 'forest'] }, { waitUntil: { room: 'forest' } }, { set: 'master_found' }, { moveActor: ['keeper', 'shop'] } ] }]
```

### Le poulet en caoutchouc avec une poulie au milieu — natif

Une sortie conditionnée, avec sa réplique quand la condition manque : `exits: { cable: { name: 'câble', to: 'island', if: { has: 'chicken' }, locked: 'Trop loin pour sauter.' } }`.

### Le labyrinthe de la forêt et la tête navigatrice — faisable

Des salles reliées par des `exits`, plusieurs ramenant à la même salle (`oneWay: true` fait taire le « sans retour » du
validateur), et un flag posé par la tête (`{ set: 'head_points' }`) qui ouvre la bonne sortie (`if: 'head_points'`).
Ça marche, c'est fastidieux à écrire, et la carte du monde du Studio aide plus que le DSL. Un labyrinthe généré n'est pas
quelque chose que ce moteur propose.

### Dix minutes sous l'eau avec l'idole — faisable

Un script avec un long `wait` et un `while: { room: 'seabed' }` : à la fin, une cinématique et un `goto` vers une salle
« game over » avec `{ end: true }`. Ce qui manque au moteur : une commande « recharger la dernière sauvegarde » ; le joueur
appuie sur Continuer à l'écran titre, ou une commande `custom` appelle `engine.load()`.

### Le concours de crachat et le vent — natif

Un script en boucle qui lève et baisse un flag, avec une animation d'accessoire en boucle pour le montrer :

```ts
scripts: [{ id: 'wind', loop: true, do: [{ wait: 3000 }, { set: 'wind_blows' }, { play: ['flag', 'flutter'] }, { wait: 3000 }, { unset: 'wind_blows' }, { stopAnim: 'flag' }] }],
on: [{ verb: 'use', a: 'spit', b: 'line', if: 'wind_blows', do: [{ set: 'spit_won' }] }]
```

Comme le solveur fait avancer un script un `wait` à la fois, il voit l'état où le vent souffle.

### Les quatre morceaux de carte — natif

Quatre objets, une règle avec `{ all: [{ has: 'piece_1' }, …] }`, ou une liste `goals` sur le checkpoint du chapitre.

### Le catalogue de la bibliothèque — natif

Un `choice` avec autant d'options que de tiroirs, une seule bonne. Depuis la v2.1 le solveur essaie chaque option.

### La poupée vaudou de Largo, quatre ingrédients — natif

Une règle par ingrédient sur la poupée (`use thread on doll` → `{ set: 'doll_thread' }`), puis l'aiguille, gardée par
`{ all: ['doll_thread', 'doll_bone', 'doll_spit', 'doll_hair'] }`.

### Stan enfermé dans le cercueil — natif

La règle du cercueil émet un événement ; un écouteur du jeu le déplace : `events: [{ on: 'coffin_closed', do: [{ moveActor: ['stan', 'coffin'] }, { set: 'stan_boxed' }] }]`.
Chaque salle où Stan peut être le liste dans `actors` ; `{ actorIn: ['stan', 'coffin'] }` garde les règles qui l'y attendent.

## Day of the Tentacle

### L'arbre planté dans le passé, vu dans le futur — natif (testé)

Deux personnages jouables. L'un pose un flag dans sa salle ; une zone de la salle de l'autre est `visible` sous ce flag.

```ts
players: { ids: ['hoagie', 'laverne'], start: { laverne: { room: 'future' } } },
// past: { verb: 'use', a: 'seed', b: 'ground', do: [{ lose: 'seed' }, { set: 'tree_planted' }] }
// future: hotspots: { tree: { name: 'arbre immense', visible: 'tree_planted' }, stump: { name: 'sol nu', visible: '!tree_planted' } }
```

### Le Chron-O-John : un objet envoyé dans une autre époque — natif (testé)

`{ transfer: ['fruit', 'hoagie'] }` met l'objet dans le sac de l'autre personnage, où qu'il soit. Donner un objet à un
personnage jouable présent dans la salle fait la même chose.

### Le hamster congelé — natif

Un objet à états, ce sont deux objets : `{ lose: 'hamster' }, { gain: 'hamster_frozen' }`. Le rapport liste les deux et d'où ils viennent.

### L'orage, l'éclair, la cinématique — natif

`cutscene` plus `parallel`, avec des événements de frame sur l'animation :
`{ parallel: [[{ anim: ['sky', 'lightning'], at: { 2: [{ sfx: 'thunder' }, { shake: 4 }] } }], [{ say: ['hoagie', 'Oh oh.'] }]] }`.

## Maniac Mansion

### L'infirmière en ronde, et le donjon — faisable, avec une autre horloge (testé)

Un script la déplace entre deux salles et émet un événement après chaque déplacement ; le `onEnter` des salles et un
écouteur du jeu attrapent le héros quand ils se croisent ; le donjon a une brique descellée.

```ts
scripts: [{ id: 'edna_patrols', loop: true, do: [{ wait: 6000 }, { moveActor: ['edna', 'hall'] }, { emit: 'edna_moved' }, { wait: 6000 }, { moveActor: ['edna', 'kitchen'] }, { emit: 'edna_moved' }] }],
events: [{ on: 'edna_moved', if: { all: [{ room: 'hall' }, { actorIn: ['edna', 'hall'] }] }, do: [{ say: ['edna', 'Je te tiens !'] }, { goto: 'dungeon' }] }],
// hall: onEnter: [{ if: { actorIn: ['edna', 'hall'] }, then: [{ say: ['edna', 'Je te tiens !'] }, { goto: 'dungeon' }] }]
```

La différence honnête avec l'original : les scripts tournent *entre* les actions du joueur, jamais pendant. La ronde est
au tour par tour, pas en temps réel : Edna ne peut pas entrer pendant que le héros parle. C'est ce qui permet au solveur
de prouver l'énigme (il attend qu'elle parte, puis traverse), et ce qu'une sauvegarde restitue exactement.

### La sonnette — natif

`{ emit: 'doorbell' }` sur le bouton, des écouteurs dans les salles qui réagissent (`once: true` pour le gag unique).

## Sam & Max

### « Utiliser Max sur… » — faisable

Le partenaire est à la fois un objet (`items: { max: { name: 'Max' } }`, dans l'inventaire de départ) et un acteur listé
dans les `actors` de chaque salle sans `room` de départ, donc toujours là. `use max on door` est une règle comme une
autre, avec un `anim` de l'acteur. Le moteur n'a pas de notion de « compagnon » ; cette convention suffit.

### Le gag récurrent quand rien ne marche — natif

`rules.fallbacks` par verbe, une liste pour varier, plus `rules.kinds` pour une réplique par sorte de chose (`kind: ['glass']`).

## Indiana Jones, Loom

### Les trois voies (équipe, ruse, poings) — natif

Un `choice` au début pose un flag ; salles, sujets et règles portent un `if` dessus. Le solveur prouve chaque voie avec
un checkpoint de chapitre par branche.

### Les bagarres, les mélodies de Loom — custom

Un mini-jeu du registre (`minigames` exporté par `games/<id>/index.ts`) : le moteur n'en dessine rien, le solveur le
compte gagné. `{ minigame: 'fists', params: { rounds: 3 }, then: [{ set: 'guard_down' }] }`.

## Ce qui reste hors champ

- Un monde en temps réel : les scripts avancent entre les actions, les animations et les boucles sont la couche temps réel (voir « Le monde vit »).
- Un second format de dialogue : sujets, `choice` et `if` sont le graphe de dialogue ; le Studio le dessine.
- La physique, le zoom, une caméra sur deux axes.
