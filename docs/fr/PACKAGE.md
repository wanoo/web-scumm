# Le moteur en paquet

Depuis la 3.9, un jeu n'a plus à vivre dans ce dépôt. Le moteur est empaqueté en `web-scumm` (le moteur, ses pages,
ses outils et la commande `web-scumm`, le modèle de jeu) et `create-web-scumm` (`npx create-web-scumm`).

## Un nouveau jeu

```bash
npx create-web-scumm mon-jeu "Mon jeu"     # ou : npx web-scumm create mon-jeu "Mon jeu"
cd mon-jeu
npm install
npm run assets      # art/ et audio/ vers public/assets (Python 3 avec Pillow : pip install -r node_modules/web-scumm/requirements.txt)
npm run dev         # ouvrir l'URL sur un téléphone, en paysage ; ?edit=start place les choses
```

Le projet :

| Chemin | Quoi |
|---|---|
| `game/` | le jeu : `game.ts`, `rooms/`, `cast.ts`, `items.ts`, `rules.ts`, `layout/`, `locales/`, `art/`, `audio/`, `provenance.json` |
| `public/` | les icônes de la page, la police complète ; `public/assets` est écrit par `npm run assets` (pas commité) |
| `dist/` | le build, avec `licenses/` (`npm run build`) |
| `tsconfig.json` | `@engine/*` pointe dans `node_modules/web-scumm/src/engine` |

L'art du modèle est provisoire, dessiné à partir de formes (`tools/placeholder-art.py`) : `provenance.json` le dit, et
une release le refuse tant que chaque fichier n'est pas remplacé et revu.

## Commandes

`npx web-scumm help` les liste. Le `package.json` du projet nomme les habituelles :

| Commande | Quoi |
|---|---|
| `web-scumm dev` / `studio` | le jeu, le Studio |
| `web-scumm assets` | l'art et l'audio vers `public/assets` |
| `web-scumm verify` | validation, solveur, traductions, lint, playtests |
| `web-scumm build` | assets, verify, le build, chaque fichier de `dist/` justifié (`docs/fr/TOOLS.md`, « Ce que l'archive contient ») |
| `web-scumm release [--commercial]` | build, puis les portes de release : verrou de provenance, budgets, traductions, voix, playtests stricts, la preuve |
| `web-scumm validate`, `solve`, `lint`, `i18n`, `weight`, `provenance`, `playtests`, `voices`, `prompts` | chaque outil, avec ses options (`docs/fr/TOOLS.md`) |
| `web-scumm migrate` | amène les sources du jeu au format du moteur installé (`docs/fr/UPGRADING.md`) |

Elles tournent avec le projet comme dossier de travail (`WEB_SCUMM_PROJECT`) : le moteur dans `node_modules/web-scumm`
est lu, jamais écrit.

## Mettre à jour

`npm install web-scumm@<version>`, puis `npx web-scumm migrate`, puis `npm run verify`. `docs/fr/UPGRADING.md` dit ce
que chaque version change ; `docs/fr/SUPPORT.md` quelles versions sont suivies et combien de temps dure une
dépréciation.

## Comment c'est vérifié

`npm run fresh-install` (un job de CI) : empaquette le moteur (`npm run pack`), crée un jeu depuis le modèle empaqueté
dans un dossier vide hors du dépôt, installe l'archive, lance `assets`, `verify` et `build`, et joue le jeu jusqu'à sa
fin dans Chromium. Un fichier du nouveau projet qui nomme le dépôt le fait échouer. Chaque release joint les deux
archives ; les publier sur npm revient au mainteneur (un jeton, les noms des paquets).
