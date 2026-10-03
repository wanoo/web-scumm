# Feuille de route : du moteur réactif au moteur de monde (v1.3 → v2.0)

*Rédigée le 3 octobre 2026 à partir d'un audit externe de la v1.2.1 ; M1 est livré en v1.3.0. Version anglaise : [docs/en/ROADMAP.md](../en/ROADMAP.md).*

## Contexte

Un audit externe de web-scumm (v1.2.1) conclut que le moteur sait produire un bon point-and-click court, mais pas confortablement un jeu de 30-100 salles, parce qu'il est purement réactif (clic → règle → commandes) et sans simulation de monde. J'ai vérifié ses 18 affirmations contre le code : 12 exactes, 4 partielles, 2 fausses (`give`/`take`/`room` ne sont pas des commandes ; les mini-jeux ne sont pas dans le core, ils sont déjà un registre extensible depuis `games/<id>/index.ts`). Le diagnostic principal tient.

Objectif de l'utilisateur : qu'une personne seule, avec n'importe quelle IA, puisse faire un jeu **complet** (long) avec ce moteur. Ce plan ordonne les évolutions par ce qui bloque réellement un jeu long, pas par fidélité à DOTT.

Ce qui est vrai aujourd'hui (vérifié dans `src/engine/core/types.ts`, `engine.ts`, `src/engine/tools/solve.ts`) :
- un seul `hero`, un seul inventaire ; acteurs stockés par `room.actor`, aucune commande ne déplace un acteur vers une autre salle ;
- aucun script autonome, aucun timer, aucun événement : `onEnter` est le seul déclencheur hors clic ; la seule boucle est le rAF du rendu ;
- 640 × 400 fixe, pas de caméra ; pas d'animation d'accessoire ni d'événement de frame ;
- sujets de conversation `{topic, if, do}` par salle, branchements via `choice`/`if` dans `do` ;
- sorties = hotspots avec `goto` ; `validate` ne construit pas de graphe de salles ;
- une seule sauvegarde (`<id>.save`), version différente ⇒ nouvelle partie, pas de migration ;
- solveur best-first, `--max 20000`, départ possible d'un checkpoint, aucune notion d'objectif ni d'invariant ;
- pas de `custom`, pas de locale, pas de `voice`, réglages = musique/sfx.

## Avis sur l'audit (ce que je garde, ce que je change)

**Je garde** : scheduler + événements + acteurs du monde comme premier jalon ; ne pas réécrire, ne pas passer à Phaser ; solveur par chapitre avec objectifs/invariants ; sauvegardes multi-slots avec migrations data-only ; debugger « pourquoi cette règle est indisponible » ; animations avec événements de frame ; escape hatch avec effets déclarés au solveur.

**Je change** :
- *Événements et scheduler sont une seule feature.* Un bus d'événements sans scripts capables d'attendre (`waitEvent`, `waitUntil`) n'est qu'un flag renommé. Les deux arrivent ensemble, dans le même format de state sérialisable.
- *Multi-protagonistes n'est pas P0* pour « n'importe qui fait un jeu complet » : c'est P0 uniquement pour DOTT. Il passe après la caméra et après les sauvegardes, parce qu'il change la forme du state et doit profiter des migrations.
- *Pas de « dialogue graph » séparé.* Les sujets + `choice` + `do` sont déjà un graphe de données ; un second format dupliquerait le DSL et casserait solveur, MCP et prompts. Ce qu'il manque est la **visualisation** dans le Studio (arbre dérivé des sujets) et le remplissage des trous connus (le Studio ne sait pas ajouter/supprimer un sujet). Le combat d'insultes est une *activité* (mini-jeu), pas une primitive de dialogue.
- *Mini-jeux → plugins* : déjà le cas (`minigames` exporté par le jeu, fusionné dans `App`). Il manque seulement la doc et un exemple hors core ; pas une priorité.
- *Localisation* : retrofit par extraction (textes identifiés par chemin `room.hotspot.look`, fichiers `locales/<lang>.json` qui surchargent) plutôt que par clés dans le contenu, pour ne pas alourdir le DSL que l'IA écrit. Reste P2.
- *Le vrai risque* n'est pas technique : chaque primitive ajoutée doit être comprise par `validate`, `solve`, CONTENT_GUIDE en/fr, le générateur de prompts, les outils MCP et le Studio, sinon l'IA ne l'utilisera pas ou mal. Chaque jalon ci-dessous inclut cette propagation, et la démo utilise chaque primitive au moins une fois.

## Principes de conception (valables pour tous les jalons)

1. **Tout reste données** : nouvelles commandes dans l'union `Cmd`, nouveaux champs typés sur `RoomDef`/`GameDef`, jamais de fonctions dans le contenu (sauf le registre `custom`, qui vit dans `index.ts` comme les mini-jeux).
2. **Tout est dans `GameState`** : compteur de programme des scripts, acteurs du monde, caméra ⇒ sauvegarde et reprise exactes, solveur déterministe.
3. **Le solveur modélise le temps comme un choix** : « laisser le script X finir son itération » est une action du solveur, les `wait` sont nuls en simulation ; les effets d'un `custom` sont déclarés (`effects: Cmd[]`).
4. **Un jalon = un bump de `saveVersion` au plus**, avec migration fournie.
5. **Le jeu privé d'origine suit** : son dépôt embarque une copie de `src/engine` ; à chaque jalon, le moteur est recopié et le jeu rejoué (e2e, 37 tests, solveur). C'est le test de non-régression grandeur nature.

## Jalons

### M1 — « World » (v1.3, livré) : le monde agit sans clic

Fichiers : `src/engine/core/{types,engine,state}.ts`, nouveau `src/engine/core/scheduler.ts`, `src/engine/tools/{validate,solve}.ts`, `src/engine/dom/{app,room}.ts`, `src/engine/dev/panel.ts`.

- **Acteurs du monde** : `GameState.actors` devient `Record<actorId, {room, x, y, pose, facing, visible}>` (clé sans préfixe de salle). `CharacterDef.room?` donne la salle initiale ; une salle liste toujours ses acteurs attendus (`RoomDef.actors`) mais le rendu lit `state.actors[id].room === room`. Commande `{ moveActor: [who, room, entry?] }`. Migration : `room.actor` → `{room: …}`.
- **Événements** : `{ emit: 'bell_rang', payload? }` ; `RoomDef.events` et `GameRules.events`: `Array<{ on: string; if?: Cond; once?: boolean; do: Cmd[] }>`. Un événement n'est pas un état : il déclenche, puis disparaît. `GameState.pendingEvents` pour ceux émis pendant une cutscene.
- **Scheduler** : `RoomDef.scripts` / `GameDef.scripts`: `Array<{ id; while?: Cond; if?: Cond; loop?: boolean; do: Cmd[] }>`. Nouvelles commandes : `{ waitUntil: Cond }`, `{ waitEvent: id }`, `{ startScript: id }`, `{ stopScript: id }`, `{ every: ms, do }` (sucre pour loop + wait). `GameState.scripts: Record<id, {pc: number[], waiting?: …}>` pour reprendre après rechargement. Les scripts tournent entre deux actions du joueur et pendant la marche ; ils se mettent en pause pendant une cutscene et un mini-jeu (règle simple, documentée).
- **Solveur** : ajoute aux actions possibles « avancer le script S jusqu'à son prochain point d'attente / fin d'itération » ; `wait` = 0 ; `waitUntil` bloque tant que la condition est fausse. `validate` : événement émis mais jamais écouté et inversement, script sans effet, `waitEvent` sur un événement jamais émis.
- **Studio / dev** : le panneau `?dev` affiche scripts actifs, acteurs du monde et file d'événements ; bouton « avancer le script ». Studio Check montre les mêmes diagnostics.
- **Démo** : le chat (ou le voisin) patrouille entre jardin et marché ; une cloche du marché émet un événement écouté par la maison.
- **Docs/outils** : CONTENT_GUIDE en/fr section « Le monde vit » ; `tools/prompts.ts` inchangé ; MCP : les outils `room`/`add` acceptent `scripts`/`events` ; AGENTS.md règle « un PNJ qui bouge est un script, pas une règle ».

### M2 — « Scale » (v1.4, livré) : tenir 40 salles sans perdre les testeurs

Fichiers : `src/engine/tools/{validate,solve}.ts`, nouveau `src/engine/tools/graph.ts`, `src/engine/dom/app.ts` (menu), nouveau `src/engine/core/migrate.ts`, `tools/pages/review.ts` ou nouvelle page `world`.

- **Sorties déclarées** : `RoomDef.exits: Record<id, { to: room; entry?: string; if?: Cond; walkTo?: Point; transition?: 'fade'|'cut' }>`. Un exit est rendu comme un hotspot (même layout), le moteur génère la règle `goto`. Les hotspots `goto` existants restent valides.
- **Graphe du monde** : `graph.ts` construit salles/sorties/entrées ; `validate` signale salle inaccessible, entrée inexistante, sortie à sens unique non voulue (sauf `oneWay: true`). Page `npm run pages -- world` : graphe cliquable (export DOT/SVG), aussi dans le Studio Check.
- **Chapitres et objectifs** : `checkpoints[i].goals?: Cond[]` et `GameDef.invariants?: Cond[]` (« jamais vrai »). `solve` : par défaut, résout checkpoint à checkpoint (chaque segment borné), puis global si demandé ; échoue si un invariant devient vrai sur un chemin atteint. Sortie `--json` enrichie des segments (l'e2e rejoue déjà le chemin).
- **Sauvegardes** : `GameDef.saves?: { slots: number }` (défaut 1 = comportement actuel). Menu pause : sauver/charger dans un slot avec salle, date, durée, miniature (capture `room` déjà possible côté Studio ; côté jeu, une capture CSS→canvas est hors budget : vignette = décor de la salle). Export/import JSON d'un slot. Clé `<id>.save.<n>`, `<id>.save` migré vers le slot 1.
- **Migrations data-only** : `GameDef.migrations?: Array<{ from: number; renameFlag?; renameItem?; renameRoom?; renameActor?; drop? }>`, appliquées en chaîne dans `migrate.ts` avant `ensureProps`. `validate` : les renommages pointent sur des ids existants.
- **Profileur de contenu** : `npm run validate -- --report` : par salle (hotspots sans `look`, verbes en repli, props sans changement), par objet (obtenu où, utilisé combien, consommé), par personnage (sujets, inatteignables, lignes > N). Même rapport dans Studio Check.
- **Démo** : 3 salles → exits déclarés, 2 checkpoints avec goals, 1 invariant, 3 slots.

### M3 — « Picture » (v1.5) : la mise en scène

Fichiers : `src/engine/core/types.ts` (Layout, PropDef, Cmd), `src/engine/dom/room.ts`, `src/engine/dev/editor.ts`, `tools/pages/placement.ts`, `tools/assets.py`.

- **Salles larges et caméra** : `Layout.width?: number` (≥ 640, hauteur reste 400) ; les coordonnées logiques s'étendent ; `assets.py` accepte des décors plus larges que 1280. `GameState.camera: {x, target?}`. Commandes `{ camera: 'follow' | {pan: x, ms} | {to: who} | 'reset' }`. `room.ts` translate le calque scène ; `shake` existe déjà. Éditeur et page de placement affichent la salle entière avec le cadre caméra. Solveur : ignore la caméra.
- **Animations d'accessoires avec événements de frame** : `PropDef.anims?: Record<name, { frames: ImgId[]; fps?; loop?; at?: Record<frameIndex, Cmd[]> }>` ; commandes `{ play: [prop, anim] }`, `{ waitAnim: prop }`. Même `at` sur les poses `anim` des personnages. Le solveur exécute les `at` dans l'ordre, sans attendre.
- **Voix** : `say` accepte `voice?: SoundId` ; `GameDef.audio.voices?` ; auto-avance à la fin du clip ; réglage voix séparé. `refs.ts`/`assets.py` prennent les clips en compte.
- **Préférences** : `GameDef.ui.settings?` active vitesse du texte, taille des sous-titres, réduction des animations/shake, police dys (fournie par le jeu dans `skin.fonts`), volumes musique/sfx/voix. Stockées hors sauvegarde.
- **Démo** : marché élargi (1,5 écran) avec suivi caméra ; porte du garde-manger animée avec `sfx` à la frame 3.

### M4 — « Cast » (v1.6) : plusieurs personnages jouables

Fichiers : `types.ts`, `engine.ts`, `state`, `dom/app.ts` (inventaire, bouton de bascule), `solve.ts`, `validate.ts`, `migrate.ts`.

- `GameDef.hero` reste valide (sucre pour un seul joueur). Nouveau `GameDef.players?: { ids: Id[]; initial: Id; sharedInventory?: boolean }`.
- `GameState.players: Record<Id, { room, inventory, hero: Record<room, Point> }>` + `GameState.active`. Les champs plats `room`/`inventory`/`hero` deviennent des vues sur le joueur actif (accès centralisé dans `state.ts` pour ne pas toucher cent endroits). Migration fournie (saveVersion +1).
- Commandes `{ switchPlayer: id }`, `{ transfer: [item, to] }` ; condition `{ player: id }` ; bouton de bascule dans l'interface, `ui` textes.
- Solveur : la bascule est une action ; le hash inclut tous les joueurs. Validate : objet transférable vers un joueur qui ne peut jamais le recevoir.
- Fixture de test dédié (voir M5) ; la démo n'en a pas besoin, un second exemple `games/trio` (3 salles, 2 joueurs) sert d'illustration et de test e2e.

### M5 — « Open » (v2.0) : ouverture et robustesse

- **Commandes custom** : `games/<id>/index.ts` exporte `commands?: Record<name, { run(ctx, args): Promise<void>; effects?: Cmd[] }>` ; commande `{ custom: name, args }`. Le solveur applique `effects` ; `validate` exige `effects` ou `pure: true`. Doc : « quand le DSL ne suffit pas ».
- **Localisation** : `npm run i18n extract` écrit `games/<id>/locales/<base>.json` (clé = chemin de contenu, valeur = texte) ; `locales/<lang>.json` surcharge au chargement ; `GameDef.lang`/sélecteur. Studio : onglet couverture (manquant, trop long). Le contenu source reste inline : rien ne change pour l'IA qui écrit un jeu.
- **Micro-jeux de test** : `tests/fixtures/{scripts,events,actors,exits,saves,camera,players}/` d'une salle chacun, un test par primitive ; le fixture actuel reste pour le socle.
- **Studio « Play »** : onglet jouant le jeu en iframe `?dev` avec inspecteur d'état (déjà dans le panneau dev) et **explicateur de règle** : clic sur un hotspot/objet → liste des règles candidates avec chaque condition évaluée ✓/✗ (réutilise `evalCond` du core, exposé en mode dev).
- **Mini-jeux** : rien à coder, documenter le registre existant comme `activities` et livrer un exemple dans `games/_template`.

## Hors plan (décisions explicites)

- Pas de Phaser ni de canvas : le Presenter DOM suffit pour quelques dizaines d'images ; une salle large reste une translation CSS.
- Pas de format de dialogue parallèle au DSL.
- Pas de paquet npm avant qu'une seconde personne le demande (inchangé).

## Vérification (à chaque jalon)

1. `npm run validate && npm run solve && npm test && npm run build` verts, CI verte, audit d'assets vert.
2. La démo utilise chaque nouvelle primitive au moins une fois et l'e2e la traverse (capture 844 × 390).
3. Une sauvegarde faite avec la version précédente de la démo se charge après migration (test unitaire sur un JSON figé par jalon).
4. Copie de `src/engine` dans le dépôt privé : 37 tests, solveur 62 actions, e2e le jeu privé d'origine identiques.
5. MCP : `npm run -s mcp` liste les outils mis à jour ; une session d'IA neuve ajoute un script/événement à la démo en suivant seulement CONTENT_GUIDE.
6. Release taguée avec notes de version ; README « Status » mis à jour.
