# Concevoir un bon jeu à la SCUMM avec ce moteur

Un guide pratique et assumé pour un auteur seul qui travaille avec une IA. Le format est dans
[CONTENT_GUIDE.md](CONTENT_GUIDE.md), la méthode dans [WORKFLOW.md](WORKFLOW.md). Cette page parle de goût : quoi
écrire pour que le jeu soit drôle, juste et terminé.

L'exemple suivi tout du long est le jeu d'exemple, *The Pantry Key* (`games/demo/`) : Pixel le chat, trois lieux
(`house`, `garden`, `market`), environ 15 minutes. Chaque id cité ici existe dans ce dossier. Les textes du jeu sont
en anglais ; ils sont cités tels quels.

## 1. Ce qui fait marcher ces jeux

Les aventures LucasArts classiques (Monkey Island, Day of the Tentacle) ont fixé quelques règles. Elles tiennent toujours.

| Règle | Ce que ça veut dire ici |
|---|---|
| **Pas de mort** | Le héros ne meurt jamais et ne perd jamais. Un mini-jeu ne peut pas être raté (`then` est toujours joué). |
| **Pas d'impasse** | Le joueur ne peut jamais arriver dans un état où le jeu ne peut plus être fini. `npm run solve` le prouve. |
| **Chaque action a une réponse** | N'importe quel verbe sur n'importe quoi donne une réplique. Un essai raté est une blague, pas un silence. |
| **L'humour est dans les échecs** | L'essentiel de ce que lit le joueur, ce sont des réactions à de mauvaises idées. C'est là qu'est la voix. |
| **Réfléchir, pas chercher le pixel** | Tout ce qui sert est nommé, visible et a une réplique Regarder. L'énigme est dans la tête, pas dans la zone cliquable. |
| **Peu de personnages, des voix fortes** | Quatre ou cinq personnages qu'on reconnaît en une réplique. |
| **Un but par lieu** | Le joueur sait toujours ce qu'il veut ici. Le storyboard le dit dans `goal`. |
| **10 à 20 minutes par lieu** | Assez pour explorer, assez court pour finir dans le bus. |

La démo les suit toutes. Pixel ne peut pas échouer. Tirer Biscuit donne « Never pull a cat. Cat law, article one. »
La clé n'est jamais cachée dans un coin : elle est dans une cuve dont un personnage vous parle.

## 2. L'histoire d'abord

Écrire l'histoire avant tout fichier de lieu. Quatre réponses, une ligne chacune :

| Question | La démo |
|---|---|
| Le pitch en une phrase | Grandma a enfermé les sardines dans le garde-manger et perdu la clé. |
| Ce que veut le héros | Pixel veut les sardines. |
| L'obstacle par lieu | Maison : personne ne sait où est la clé. Jardin : elle est tombée dans une cuve au robinet coincé. Marché : elle sert de caution pour une lanterne. |
| La fin | Le garde-manger s'ouvre, deux chats pour une boîte, la carte scellée juge le pari du joueur. |

Si ce tableau ne se remplit pas, n'ouvrez pas encore l'éditeur.

### L'écrire comme un storyboard

`games/<id>/storyboard.json` est la source de vérité de chaque texte ([schéma](../../tools/pages/storyboard-schema.md)).

- **Un tableau par lieu**, dans l'ordre du jeu, avec son `goal`. La démo a `opening`, `house`, `garden`, `market`, `finale`.
- **Une case par moment.** Un moment, c'est quelque chose qui change : un objet gagné, une porte ouverte, une révélation.
- **Chaque case nomme l'`action` du joueur** qui la déclenche : `garden-1` « Pick up pipe », `garden-3` « Use pipe
  with water tank → minigame pipes », `garden-5` « Look at sock ». Si l'action ne s'écrit pas, ce n'est pas encore une énigme.
- **`talks`, `reactions` et `hints`** sont sur le tableau. Les réactions sont les gags facultatifs ; les indices vont
  du vague au précis.

Le relire sur un téléphone (`npm run page:storyboard`) jusqu'à ce que l'auteur dise que c'est final. Ensuite seulement,
écrire les lieux.

### Le rythme des regards répétés

Une liste `look` tourne, une réplique par regard. Suivre le rythme **normal, normal, normal, absurde** : trois répliques
utiles ou sobres, puis une blague qui récompense le joueur qui insiste. Le garde-manger de la démo :

```ts
pantry: ['The pantry cupboard. The sardines live in there.',
  'Locked. I can hear the sardines. (Sardines are silent. I hear them anyway.)',
  'Still locked. Still sardines.', 'I could stare at it all day. I might.'],
```

Deux répliques suffisent pour le décor (`gnome` : « He has seen things. » puis « He never blinks. Respect. »).
Ne jamais mettre la solution seulement dans la quatrième réplique.

## 3. Concevoir les énigmes avec ce moteur

### Les cinq formes que le DSL gère bien

| Forme | Comment l'écrire | Dans la démo |
|---|---|---|
| **Aller chercher et donner** | règle `give` avec `a` = objet, `b` = acteur | `bouquet` → `seller` donne la `key` |
| **Combiner deux objets** (ou un objet sur une chose) | règle `use` avec `a` et `b` ; dans `rules.on` si ça marche partout | `pipe` sur `tank` |
| **Accessoire à états** | `states` + commande `{ prop: [...] }` + `if: { prop: [...] }` | `armchair` : `remote` → `searched` ; `tank` : `full` → `draining` ; `pantry` : `locked` → `open` |
| **Déblocage par dialogue** | un sujet qui pose un drapeau ou `unlock` un lieu | « Where is the key? » de Grandma débloque `garden` ; le sujet de Lou pose `deposit_known` |
| **Mini-jeu comme porte** | `{ minigame, params, then }` dans une règle | `pipes` vide la cuve, `pick` fait gagner le bouquet |

Le reste (minuteries, action en temps réel, hasard) se bat contre le solveur. À éviter.

### Les chaînes et le « eurêka »

- **3 à 6 étapes par lieu.** Le jardin : prendre `spare_pipe` → utiliser `pipe` sur `tank` → tuyaux → regarder `sock`
  → parler au `shell_phone`. Cinq étapes.
- **Un « eurêka » par lieu.** Celui du jardin, c'est la chaussette : on vide une cuve pour une clé et on trouve un mot.
  Celui du marché, c'est l'anniversaire : le vendeur voulait des fleurs parce qu'il a oublié son anniversaire de mariage.
- **Traverser les lieux une ou deux fois.** Le `token` vient du fauteuil de la maison et paie au marché. Ça suffit.
- **Dire le but à voix haute.** Grandpa dit « Drain it. But the tap is stuck. » Le joueur sait *quoi*, pas *comment*.

### Les indices dans l'ordre de l'énigme

Chaque lieu a des `hints`. Le moteur donne la première entrée dont la condition `until` est encore fausse. Les écrire
dans l'ordre de l'énigme, une entrée par étape, du vague au précis dans une entrée. Le jardin :

```ts
hints: [
  { until: { any: ['pipe_taken', 'tank_drained'] }, lines: ['There is a spare pipe on the ground. Take it, sweetie.'] },
  { until: 'tank_drained', lines: ['Use the pipe on the water tank.', 'Pipe. Tank. Together. Go!'] },
  { until: 'lou_has_key', lines: ['Something came out of the tank. Look at it.'] },
  { until: { unlocked: 'market' }, lines: ['Talk into my shell phone and call Lou.'] },
  { until: { has: 'key' }, lines: ['Lou is at the market. Open the map.'] },
  { until: 'pantry_open', lines: ['Come home with that key, sweetie!'] },
],
```

Deux habitudes : `any` quand une étape peut être sautée (le tuyau a disparu une fois la cuve vidée), et toujours
couvrir la suite du jeu, pour que la voix d'aide ne se taise jamais dans un lieu où le joueur revient.

### Ce que prouve le solveur

`npm run solve` joue le vrai moteur avec un écran muet. Il essaie chaque action depuis « Nouvelle partie », ne garde
que les états qui diffèrent sur ce qui compte, et s'arrête à la fin. La démo affiche « The game can be finished » et
un chemin de 16 actions, de « (tutorial) Look at pantry » à « Use key with pantry ». Ce que le solveur trouve, un
joueur peut le faire.

Il affiche aussi trois alertes à lire :

| Sortie | Sens | Correction |
|---|---|---|
| `Dead ends (n): - garden, inventory [shell_phone, pipe] after: A › B › C` | Un état où aucune action ne change rien | Un objet consommé sans moyen d'en avoir un autre, un drapeau qui ferme le seul passage, ou un `if` de sujet qui cache l'indice. Rendre l'objet, ou assouplir la condition. |
| `Items obtained but never used in a rule` | Une fausse piste, ou une énigme oubliée | S'en servir, ou le retirer. Un objet inutile visible coûte des minutes au joueur. |
| `Items never obtained` | Déclaré dans `items` mais rien ne le donne | Ajouter le `gain`, ou supprimer l'objet. |

`npm run solve -- --from=market` part d'un point de reprise, pratique quand on travaille sur un seul lieu.

## 4. Les lieux

| Élément | Règle empirique |
|---|---|
| Zones + accessoires nommés + acteurs | **8 à 15** par lieu. Moins, c'est vide ; plus, c'est de la chasse au pixel. La maison de la démo a 11 choses nommées. |
| Accessoires à états | Seulement pour ce que l'histoire change (`armchair`, `tank`, `pantry`). |
| Accessoires de décor | Sans `name` = pas cliquable (`table`, `chair`, `stall_left`). Ils habillent la scène. |
| Sorties | Une sortie évidente, au bord de l'écran, nommée d'après sa destination (`back_door` : « Back to Grandma's house. »). |

- **Espace logique : 640 × 400**, origine en haut à gauche, personnages placés par les pieds.
- **La bande de sol.** La zone de marche est dans le bas du décor ; `floor` (395 par défaut) en est le bas.
  La garder libre de meubles dessinés, pour que accessoires et acteurs s'y posent.
- **Les tailles des personnages** sont en pixels de cet espace : dans la démo, Pixel fait 36, Grandma 120, Grandpa (assis)
  100. Un humain entre 110 et 125 dans une pièce de 640 de large se lit bien sur un téléphone.
- **Points d'approche** : les poser dans l'éditeur (`?edit=<room>`), pour que le héros marche à côté d'une chose, pas
  dessus. `validate` prévient quand une cible de `walk` n'a pas de géométrie.
- **Les sorties sont des choses cliquables**, pas des bords invisibles. Une sortie fermée répond quand même : la
  `window` de la maison dit « Not yet. First, the key. Grandma knows things. » tant que le jardin n'est pas débloqué.
- **Un point de reprise par lieu** dans `game.checkpoints`, avec l'inventaire, les drapeaux et les accessoires que le
  joueur aurait. La démo a `house`, `garden`, `market`, `finale`. Ouvrir `?dev&at=market` pour tester ce lieu seul.

## 5. Les dialogues

- **2 à 4 sujets par personnage, dont un qui fait avancer l'histoire.** Grandma : « Where is the key? » (l'histoire),
  « What is for dinner? » (gag avec `nth`), « Why lock the sardines? » (le personnage). Le sujet utile passe en premier.
- **Les sujets peuvent apparaître et changer** avec `if` : « There was no key in the tank! » de Grandpa n'apparaît qu'avec `tank_drained`.
- **`choice` avec parcimonie.** Quand la réponse est drôle à choisir, pas pour faire bifurquer l'histoire. La démo en a
  deux : le pari d'ouverture (il pose `guess`, jugé à la fin) et « argue or accept » avec Lou, où les deux réponses avancent.
- **Câlin et au revoir sont globaux** (`globalTalk`) : « Can I have a cuddle? » et « Bye! » s'ajoutent à chaque menu.
  Donner à chaque personnage une réplique `hug` et une réplique `refuse` dans `cast.ts` : ça coûte peu et les joueurs adorent.
- **Couleurs de parole** : le `color` de chaque personnage. Les rendre distinctes : Grandma `#ff9ec4`, Grandpa `#8fd3ff`,
  Lou `#b8ff8f`, le vendeur `#ffb36b`. La voix d'aide `grandma_voice` reprend exprès la couleur de Grandma.
- **La transcription** garde chaque réplique. Les joueurs remontent : ne pas cacher le seul indice dans une réplique de
  cinématique sans autre trace.
- **Longueur pour un téléphone : moins de 90 caractères**, deux lignes à l'écran. `validate` prévient au-delà de 140,
  mais 90 est la limite confortable. Couper les longues tirades en plusieurs `say`.

## 6. La couche de repli

La plupart des clics ne touchent aucune règle écrite. Ce qui leur répond, c'est la voix du jeu.

- **`rules.fallbacks` : 3 à 6 variantes par verbe**, tirées au hasard, jamais deux fois de suite. Un tableau par
  verbe, plus `use2` pour « Utiliser A avec B ». La démo en a deux ou trois ; viser plus dans un vrai jeu.
- **Les écrire dans le ton du héros.** Le `push` de Pixel : « It does not move. I need more breakfast. » Son `use2` :
  « These do not go together. Like cats and baths. » `{objet}`, `{cible}` et `{nom}` insèrent les noms.
- **`kinds`** répond à toute une famille d'un coup : chaque `cat` refuse d'être tiré, chaque `person` refuse d'être
  porté. Une `target` précise l'emporte sur un `kind`.
- **`refuse` par personnage** répond à tout Donner sans règle : Lou dit « Thanks, but my pockets are full. Of other
  people's things. »
- **« Ça ne marche pas » n'est jamais acceptable.** Ça n'apprend rien au joueur et ça casse l'ambiance. Une réponse de
  repli est une blague, un rappel de ce que veut le héros, ou les deux.

## 7. Les mini-jeux

En utiliser un comme **une porte que le joueur comprend** : la fiction dit pourquoi on y joue. La cuve a besoin d'une
autre sortie, alors on pose des tuyaux. Le vendeur veut des fleurs, alors on les cueille.

- **Toujours un bouton Passer**, sauf le ticket `scratch` de la fin. Passer joue quand même `then` : l'histoire continue.
- **30 secondes, pas 3 minutes.** Trois manches de `pick`, une grille 4 × 3 de `pipes`. `helpAfter` fait briller le
  bon tuyau quand le joueur est perdu.
- **Les répliques `intro` et `win`** l'encadrent dans la voix d'aide.

| Mini-jeu | Va avec une fiction sur |
|---|---|
| `pipes` | l'eau, la plomberie, l'arrosage, tout ce qui coule |
| `cables` | l'électricité, un standard, le nœud derrière la télé |
| `pick` | les courses, choisir le bon, une recette, une confrontation |
| `hide` | cache-cache, trouver quelqu'un ou quelque chose dans une scène |
| `runner` | une poursuite, une fuite, une course pour attraper un bus |
| `stroke` | calmer un animal, endormir un bébé |
| `scratch` | la fin scellée seulement |

## 8. La carte

- **En ajouter une à partir de trois lieux.** Avec deux, une porte suffit.
- **Les véhicules** (`vehicle: 'car'`, `'plane'`) donnent à chaque trajet une petite animation et une distance.
- **Le marqueur « nouveau »** montre où quelque chose attend. La démo : le jardin en a un tant que `!tank_drained`,
  la maison quand on tient la clé et que le garde-manger est encore fermé.
- **Aucun lieu verrouillé affiché.** Un lieu apparaît quand une règle le `unlock`, avec un `toast` (« New on the map:
  the garden »). Le joueur ne doit jamais voir une épingle inutilisable.

## 9. La cohérence graphique

- **Une planche de référence** pour le style, jointe à chaque prompt d'image. Voir [PROMPTS.md](PROMPTS.md).
- **Discipline des couleurs** : chaque prompt porte les COLOR RULES (4 aplats au plus par matière, avec décalage de
  teinte, une seule couleur de contour, les mêmes tons sur chaque image). `artStyle` dans `site.json` choisit `cel`
  (défaut) ou `pixel`, dont les outils imposent ensuite des couleurs exactes. Voir [PROMPTS.md](PROMPTS.md).
- **Générer les prompts, ne pas les improviser** : `npm run prompts` les écrit depuis le contenu (la `description` de
  chaque lieu et de chaque personnage), pour que noms, apparences et tailles concordent.
- **Des décors avec une bande de sol vide** et sans personnages : 1536 × 960, personnages et accessoires viennent par-dessus.
- **Les états d'un accessoire dessinés sur la même planche, même taille, même angle.** `remote` et `searched` de
  `armchair` sont `home2/r2c1` et `home2/r2c2` : côte à côte, pour que le changement ne saute pas.
- **Découper, puis relire** : `tools/cut-sheet.py` découpe une planche, `npm run page:review` montre chaque case avec
  garder / refaire / inutile. Ne régénérer que les cases « refaire ».
- **Ne jamais redécouper un sprite validé.** Redécouper une planche à la fois, après une sauvegarde. Les placements et
  les bouches dépendent des cases.

## 10. Le son

- **Une boucle par lieu**, posée avec `music` sur le lieu. Courte et discrète ; le joueur l'entend 15 minutes. (La démo
  n'en a pas encore et le dit dans `game.ts` : mieux vaut le silence qu'une mauvaise boucle.)
- **Un bruitage à chaque changement d'état.** Fauteuil fouillé : `cloth`. Cuve vidée : `drop`. Garde-manger : `latch`
  puis `door_open`. Objet gagné : `select`, `pluck`, `metal`. Un changement sans son ressemble à un bug.
- **La voix d'aide** est un personnage `offscreen` (`grandma_voice`) qui répond par l'objet d'aide (`shell_phone`).
  En faire quelqu'un que le joueur aime, avec un tic (« sweetie »), pour que les indices sonnent comme de l'aide, pas comme un manuel.

## 11. Tester comme un joueur

| Étape | Commande | Attrape |
|---|---|---|
| Valider | `npm run validate` | ids cassés, Regarder manquants, répliques trop longues, drapeaux jamais posés |
| Résoudre | `npm run solve` | impasses, fin inatteignable, objets jamais utilisés |
| Test de parcours | `npm test` (`tests/demo-walkthrough.test.ts`) | une partie complète scriptée sur le vrai moteur |
| Captures | `npm run e2e` | ce que le solveur ne voit pas : un personnage sur une table, une réplique coupée par le bord |
| Un vrai téléphone | `npm run dev`, en paysage | taille des pouces, lisibilité, son, l'écran « tournez le téléphone » |
| Fin scellée | `npm run seal`, `npm run build`, `npm run check:spoilers` | le texte de fin jamais en clair |

Puis donner le téléphone à quelqu'un qui n'a jamais vu le jeu, et se taire. Chaque fois qu'il hésite plus d'une minute,
le noter : c'est un Regarder manquant, un indice flou, ou une sortie que personne n'a vue. Voir [TOOLS.md](TOOLS.md) et
[STUDIO.md](STUDIO.md) (l'onglet Check lance validate et solve au même endroit).

## 12. Avant de partager le lien

- [ ] Pitch, envie, obstacle par lieu et fin tiennent en quatre lignes.
- [ ] Le storyboard est final, et chaque texte des lieux en vient.
- [ ] Chaque lieu a un but, 3 à 6 étapes, un « eurêka », 8 à 15 choses nommées.
- [ ] Chaque chose nommée a un Regarder ; les regards répétés suivent normal, normal, normal, absurde.
- [ ] Chaque personnage a 2 à 4 sujets, un `hug`, un `refuse` et une couleur distincte.
- [ ] Chaque verbe a 3 à 6 réponses de repli dans la voix du héros. Pas de « Ça ne marche pas ».
- [ ] Les indices couvrent chaque étape de chaque lieu, dans l'ordre, jusqu'à la fin.
- [ ] Chaque mini-jeu a une raison dans l'histoire, un bouton Passer, et dure environ 30 secondes.
- [ ] La carte ne montre que les lieux débloqués ; les marqueurs « nouveau » pointent vers la suite.
- [ ] Chaque changement d'état a un son.
- [ ] Aucune réplique au-delà de 90 caractères.
- [ ] `npm run validate` : aucune erreur. `npm run solve` : fini, sans impasse, sans objet inutilisé.
- [ ] `npm test` et `npm run e2e` passent ; captures relues.
- [ ] Joué du début à la fin sur un vrai téléphone, en paysage.
- [ ] Fin scellée vérifiée avec `npm run check:spoilers`.
- [ ] Quelqu'un d'autre y a joué sans aide.
