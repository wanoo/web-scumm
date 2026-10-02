# Studio : édition WYSIWYG locale, porte ouverte à n'importe quelle IA

`npm run studio` démarre le serveur de dev avec le Studio à `/__studio/`. Rien ne quitte la machine : chaque
changement est écrit dans des fichiers sous `games/<id>/`, les mêmes fichiers qu'un assistant IA ou un collègue
modifie avec git. Le Studio affiche le vrai moteur (le lieu rendu par `src/engine/dom`), donc ce qu'on voit est ce
que les joueurs auront.

## Organisation du Studio
- **Rooms** (onglet par défaut) : le lieu rendu par le moteur avec l'éditeur de placement par-dessus (glisser les
  zones, les pieds, les hauteurs, les points d'approche, la zone marchable, les lignes d'échelle, les entrées), la
  liste des accessoires / acteurs / zones cliquables du lieu à droite. En sélectionner un (dans la liste ou dans la
  vue) ouvre sa fiche : nom, sorte, états, visibilité, **lignes de Regarder** (ajouter, modifier, supprimer),
  **réactions** (verbe, cibles, condition, commandes en liste de lignes : textes modifiables, autres commandes
  affichées), **sujets de conversation** ; sous la vue, le nom du lieu, les **indices** et les lignes **à
  l'entrée**. Un texte est enregistré quand le champ perd le focus (Entrée) ; Échap annule. Chaque enregistrement
  affiche un toast et lance Check en arrière-plan ; un placement en cours dans la vue est enregistré d'abord (la vue
  se recharge quand le fichier du lieu change). Les modifications de texte sont écrites directement dans
  `rooms/<room>.ts` (les littéraux de chaîne sont remplacés via l'analyseur TypeScript ; le fichier reste du code
  lisible). « Add prop / hotspot / actor » crée l'entrée dans le fichier du lieu et la place dans le layout.
- **Storyboard** : un éditeur pour `storyboard.json` (schéma : `tools/pages/storyboard-schema.md`). À gauche, les
  tableaux (titre, lieu, objectif) avec monter / descendre, ajouter, supprimer. Au milieu, le tableau sélectionné :
  titre, id, lieu (« Open in Rooms » bascule sur ce lieu), objectif, sortie, ses lignes d'**arrivée**, ses **cases**
  en cartes dans l'ordre de jeu (titre, id, l'**action** du joueur qui la déclenche, les **répliques** avec un choix
  de locuteur : les personnages du jeu, `hero`, `action`, `stage` ; des puces **sfx** tirées de `audio.sfx` du jeu ;
  par réplique : déplacer, supprimer, « + line » ; par case : déplacer, dupliquer, supprimer), puis les **indices**
  (dans l'ordre), les **sujets de conversation** par personnage (sujet + répliques) et les **réactions**
  facultatives (action + répliques). À droite, la case sélectionnée composée comme une vignette de storyboard : le
  décor du lieu, les portraits des locuteurs de la case (celui qui parle en surbrillance), la réplique courante dans
  le style de parole du jeu (couleur du locuteur ; parcourir les répliques, ou cliquer sur l'une dans le script
  ci-dessous), l'action présentée comme la phrase du jeu, les sfx ; en dessous, les notes sur cette case (`about` =
  id de la case) et une zone pour en ajouter une.
  Chaque modification reste en mémoire jusqu'à ce que **Save** (ou Ctrl/Cmd+S) écrive le document entier ; « ●
  Unsaved changes » s'affiche jusque-là, et quitter la page le demande d'abord. Save refuse les ids de case
  dupliqués ou vides (les notes s'y accrochent). Quand `storyboard.json` change sur le disque (une IA, un éditeur,
  git), une bannière propose de recharger ; avec des modifications non enregistrées, elle prévient qu'enregistrer
  écraserait ce changement. **Export Markdown** écrit `games/<id>/storyboard.md` à partir du fichier enregistré
  (le même texte que `npm run page:storyboard -- --md` ; elle propose d'enregistrer d'abord).
- **Assets** : toutes les images et tous les sons du jeu, où chacun sert, son prompt de génération, et les envois qui
  les remplacent ou les ajoutent (voir « Onglet Assets » plus bas).
- **Check** : le validateur et le solveur tournent après chaque enregistrement ; leur sortie et le chemin du
  solveur sont affichés ici. « Screenshot » rend un lieu à un checkpoint (nécessite Playwright).
- **Notes** : le journal partagé (`games/<id>/notes.json`), une entrée par auteur (« you », ou le nom de l'IA), à
  propos d'un id de case, d'un id de lieu, de `lieu.entité`, ou de n'importe quoi (vide : général). Le journal
  entier, le plus récent d'abord, groupé par `about` (lieu / case / entité étiquetés, avec « Open in Rooms » /
  « Open in Storyboard ») ; filtres : texte libre, about (lieux avec leurs entités, cases, autres), auteur. Une zone
  de saisie (about, auteur par défaut `you` et mémorisé, texte ; Ctrl/Cmd+Entrée ajoute). Chaque note montre son
  auteur et son heure, et **Reply** (préremplit `about`), **Edit** (sur place) et **Delete**. Les notes à propos
  d'un lieu ou d'une de ses entités apparaissent aussi en bas de la section de ce lieu dans l'onglet **Rooms**
  (« Notes (n) », avec une zone pour en ajouter une). Le journal suit les changements sur le disque (une IA qui
  écrit une note apparaît).

## L'API (`/__studio/api/*`, JSON, serveur de dev uniquement)
Tous les chemins sont relatifs au jeu courant (`GAME`). Les erreurs renvoient `{ error }` avec un statut 4xx/5xx
(400 entrée invalide, 404 lieu / chemin / endpoint inconnu, 405 mauvaise méthode, 409 existe déjà, 422 pas de
`defineRoom({...})` dans le fichier, 500 le jeu ne se charge pas ou une modification casserait le fichier, 501
capture d'écran indisponible).

| Méthode, chemin | Corps → Résultat |
|---|---|
| GET `game` | `{ id, title, hero, rooms: [{ id, name, decor }], characters: { id: { name, color, portrait } }, items: { id: { name, icon } }, verbs, checkpoints, images, sfx }` (depuis le module du jeu ; `images` est le manifeste des assets, id → `[w, h]`, vignettes à `/assets/img/<id>.webp` ; `sfx` les ids de `audio.sfx`) |
| GET `room/:id` | `{ def: RoomDef, layout: Layout, texts: TextRef[], file }` — `TextRef = { path, value, file, line, kind, who? }` pour chaque littéral de texte du fichier du lieu (voir « Textes » ci-dessous) |
| PUT `room/:id/layout` | `Layout` → écrit `layout/<id>.json` ; `{ ok }` |
| PUT `room/:id/text` | `{ path, value }` → remplace ce littéral de chaîne dans `rooms/<id>.ts` ; `value: null` supprime une ligne de liste (ou tout un `look.<id>`) ; un chemin finissant par `[+]` ajoute une ligne (`look.piano[+]`, `hints[2].lines[+]`, `on[3].do[+]`) ; résultat `{ ok, line, changed }` (`changed: false` quand la valeur était déjà là : rien n'est écrit) |
| POST `room/:id/add` | `{ kind: 'prop' \| 'hotspot' \| 'actor', id, name?, img?, char?, at: [x, y], look? }` → insère l'entrée dans le fichier du lieu (la section est créée si absente), la première ligne de Regarder facultative, et une place dans le layout (accessoire : pied à `at`, hauteur 60 ; zone cliquable : boîte 60 × 60 centrée sur `at` ; acteur : pieds à `at`) ; `{ ok, line, changed }`. `name` est obligatoire pour les accessoires et les zones cliquables |
| GET/PUT `storyboard` | `storyboard.json` (`{ boards: [] }` si absent). PUT attend `{ boards: [...] }`, renvoie `{ ok, changed }` : un storyboard inchangé n'est pas réécrit, un storyboard modifié est écrit de façon compacte (ce qui tient sur 120 colonnes reste sur une ligne) |
| POST `storyboard/markdown` | → écrit `games/<id>/storyboard.md` à partir du `storyboard.json` enregistré (même texte que `npm run page:storyboard -- --md`) ; `{ ok, file, bytes, boards, panels }` ; 404 sans `storyboard.json` |
| GET `notes`, POST `notes` | GET → `{ entries: Note[] }` ; POST `{ about?, author?, text }` → la nouvelle `Note = { id, about, author, text, at, edited? }` (auteur par défaut `you`, `at` est une date ISO), ajoutée à `notes.json` (créé à la première écriture) |
| PUT `notes/:id` | `{ text, about? }` → la `Note` mise à jour (texte débarrassé des espaces superflus, `edited` réglé à maintenant ; `at`, `author` et l'ordre inchangés) ; 400 texte vide, 404 id inconnu |
| DELETE `notes/:id` | → `{ ok }`, la note retirée de `notes.json` ; 404 id inconnu |
| POST `validate` | → `{ ok, errors: string[], warnings: string[], ms }` |
| POST `solve` | `{ from?: checkpoint }` → `{ finished, states, truncated, path, roomsReached, unlockedReached, flagsReached, itemsNeverUsed, unusedItems, deadEnds: [{ room, inventory, path }], errors, from, ms }` (400 pour un checkpoint inconnu) |
| POST `screenshot` | `{ room, checkpoint? }` → `{ file, url }` : un PNG du lieu (overlays de l'éditeur masqués) sous `.cache/studio/<game>-<room>[-<checkpoint>].png`, servi à `url` (`GET screenshots/<name>.png`). 501 `{ unavailable: true, reason, error }` si Playwright ou son Chromium est manquant |
| GET `events` | évènements envoyés par le serveur (SSE) : `{ type: 'hello', game }` à la connexion, puis `{ type: 'changed', file }` quand un fichier du dossier du jeu change sur le disque (`file` relatif à ce dossier, ex. `rooms/house.ts` ; les dotfiles et `private/` sont ignorés ; anti-rebond de 150 ms par fichier) |

Les mêmes opérations existent comme de simples fonctions dans `tools/studio/core.ts`, utilisées par le plugin Vite,
par les tests et par le serveur MCP : `gameInfo()`, `getRoom(id)`, `setLayout(id, layout)`, `setText(id, path, value)`,
`addEntity(id, e)`, `getStoryboard()`, `setStoryboard(sb)`, `exportStoryboardMarkdown()`, `getNotes()`, `addNote(n)`,
`editNote(id, { text, about? })`, `deleteNote(id)`, `validate()`, `solve(from?)`,
`screenshot(room, checkpoint, devServerUrl)` pour le jeu courant, et `createStudio({ gameDir, root, importFresh })`
pour n'importe quel autre dossier de jeu. Elles ne quittent jamais le processus : les erreurs sont levées comme
`StudioError` (avec `status`). Le jeu est réimporté à chaque appel pour que les modifications sur le disque soient
prises en compte : par défaut avec le chargeur ciblé de tsx (rapide, dans le même processus) ; `importInChild` (un
processus enfant node + tsx) est le repli là où les imports dans le même processus sont mis en cache, par exemple
dans Vitest. Les écritures sont sérialisées. Les types partagés sont dans `tools/studio/types.ts` ; le schéma du
storyboard, sa normalisation et l'export Markdown sont dans `tools/pages/storyboard-data.ts` (pur, partagé par le
générateur de pages, le core et l'UI).

### Textes
Un littéral de chaîne sous `defineRoom({...})` est un texte, repéré par son chemin JSON, quand le chemin finit par
`name`, `topic`, `toast`, `lines[n]`, `say[1]`, `shout[1]`, `guide.say`, `choice[n].text`, `look.<id>` ou
`look.<id>[n]`, ou quand c'est une chaîne nue dans une liste de commandes (`do`, `once`, `then`, `else`, `cutscene`,
`after`, `onEnter`, ou une branche de `nth`, `cycle`, `random`, `parallel`) : ce sont des répliques du héros. `kind`
dit laquelle (`name`, `look`, `say`, `hero`, `topic`, `hint`, `toast`, `choice`, `guide`) ; `who` est le locuteur d'un
`say`. Les ids, références d'image, flags et conditions ne sont jamais des textes, et l'API refuse de les modifier.
Un remplacement ne touche que le littéral (même style de guillemets, échappé si besoin) ; un ajout suit la mise en
forme de la liste (en ligne, ou un élément par ligne avec la même indentation) ; une suppression retire l'élément et
son séparateur. Les chemins des éléments suivants se décalent après un ajout ou une suppression : relire le lieu.

### Diffusion
La page du Studio est `studio.html` à la racine du dépôt (point d'entrée `src/studio/main.ts`). N'importe quel
serveur de dev la sert à `/__studio/` (`npm run dev` aussi) ; `npm run studio` l'ouvre en plus. Un build de
production ne l'inclut pas, sauf `STUDIO=1`. L'onglet **Rooms** affiche `/?edit=<room>&at=<checkpoint>` dans une
iframe et parle à l'éditeur via `postMessage` (voir TOOLS.md, « L'éditeur de placement »). La page du Studio ignore
les rechargements complets de Vite causés par les fichiers du jeu (la vue du moteur se recharge, le Studio garde ce
qu'on est en train de taper et suit le changement via `events`).

## Onglet Assets
À gauche, l'arbre : Characters (une entrée par planche de sprites), Objects, Backgrounds, Furniture, Talk kits, Sounds,
avec des pastilles (rouge : référencé sans fichier ; orange : pas encore préparé ; gris : découpé mais inutilisé). Au
centre, la planche en vignettes avec l'usage de chaque case et des filtres ; au-dessus, le **prompt** de la planche
(bouton **Copy prompt**, variante « cases manquantes seulement », bloc Style partagé) et **Upload generated sheet…**,
qui découpe l'image avec `tools/cut-sheet.py` sans jamais redécouper une case existante sans la cocher. À droite, la
case en grand, où elle sert, **Replace…** (l'ancien fichier est gardé en `<case>_v<N>.png`) et ses sauvegardes. Les
décors s'affichent avec les zones du lieu par-dessus ; les sons ont un lecteur. **Prepare assets** lance
`npm run assets` et affiche sa sortie. En démo, tout est en lecture seule. Points d'accès et détails :
docs/en/STUDIO.md, « Assets tab ».

## Mode démo
Le Studio tourne aussi sans serveur, sur un hébergement statique : https://wanoo.github.io/web-scumm/studio.html est le
Studio du jeu d'exemple, construit par la CI. Même interface, même vue du moteur et même éditeur de placement ; les
modifications restent dans le navigateur (`localStorage`, une liste de patchs rejouée sur un instantané du jeu écrit
au build, `public/studio-demo/snapshot.json`). Validate et Solve tournent dans la page sur le vrai jeu modifié ; les
captures d'écran demandent le serveur de dev. Le bandeau propose **Download patch** (un fichier JSON) et **Reset
demo** ; `npm run studio-apply patch.json` applique ce fichier à ta copie via le cœur du Studio. Build :
`npm run build:studio-demo` (`STUDIO=1 VITE_STUDIO_DEMO=1`). Détails dans `docs/en/STUDIO.md`, « Demo mode ».

## Assistant
Le bouton **Assistant** de la barre du haut (ou la touche `a` hors d'un champ) ouvre un tiroir à droite. On y demande
à n'importe quel modèle de conversation (OpenAI, Anthropic, Ollama, Mistral, tout point d'accès compatible OpenAI)
d'aider à compléter le jeu. Il a les mêmes outils que le serveur MCP (registre commun `tools/studio/tools.ts`) et part
de l'élément sélectionné (pièce et entité, panneau du storyboard, ou le jeu entier). Le serveur du Studio relaie la
conversation (`POST /__studio/api/assistant/chat`, événements SSE, 12 tours d'outils au plus). La clé d'API reste dans
le `localStorage` du navigateur et n'est jamais écrite sur disque ni journalisée. Sans clé, **Send as a task**
écrit une note `task: true` dans `notes.json`, qu'un agent connecté en MCP reprend avec `get_notes`. En mode démo, la
page appelle le fournisseur elle-même (Ollama local conseillé ; OpenAI refuse parfois les appels depuis un navigateur).
Détails : docs/en/STUDIO.md, section « Assistant ».

## N'importe quelle IA, pas une seule IA
- `AGENTS.md` à la racine du dépôt est le manuel d'exploitation neutre vis-à-vis du fournisseur (`CLAUDE.md` y
  renvoie).
- `npm run mcp` démarre un serveur [Model Context Protocol](https://modelcontextprotocol.io) (stdio) qui expose
  l'API ci-dessus comme des outils : `list_rooms`, `get_room`, `set_layout`, `set_text`, `add_entity`,
  `get_storyboard`, `set_storyboard`, `get_notes`, `add_note`, `validate`, `solve`, `screenshot`. Claude Code,
  Cursor, Codex, Gemini CLI, ou un agent écrit à la main s'y connectent de la même façon (`docs/fr/MCP.md` a la
  config en deux lignes pour chacun).
- Une IA sans MCP fonctionne quand même : elle modifie les fichiers, le Studio se recharge (surveillance des
  fichiers), l'humain voit le résultat, répond dans **Notes** ou dans le **Storyboard**, et l'IA relit `notes.json`.
  Git porte l'historique.
