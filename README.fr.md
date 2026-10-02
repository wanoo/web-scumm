# pocket-scumm

Un moteur de point & click façon SCUMM pour téléphone, avec ses outils d'écriture et la méthode de travail avec une IA
qui a permis de livrer un jeu familial complet de 9 lieux en trois semaines. L'histoire s'écrit en données, les choses
se placent à la souris ou au doigt, un solveur prouve que le jeu se finit, et il se joue en paysage sur n'importe quel
téléphone, hors ligne après la première visite.

*[English version](README.md)* · Jeu d'exemple : **The Pantry Key** (`games/demo`).

## Ce qu'il y a dedans
- **Un moteur** (`src/engine`, TypeScript, sans framework) : les 9 verbes classiques, le sac, des dialogues avec
  transcription, des indices, une carte du monde avec véhicules, des cinématiques, des appels à deux voix, des
  mini-jeux (tuyaux, câbles emmêlés, choix d'image, cache-cache, course, caresses, ticket à gratter), une **fin
  scellée** facultative (chiffrée, dévoilée en jouant), sauvegarde, tactile et souris, mises en page téléphone et
  ordinateur, cache hors ligne.
- **Un format de contenu** en données pures : lieux, accessoires à états, personnages, réactions (`verbe` + cible +
  condition + commandes), sujets de conversation, indices. Aucune fonction, donc tout se vérifie.
- **Des outils** : validateur, solveur, éditeur de placement dans le navigateur, chaîne d'assets (planches générées
  par IA → sprites découpés → webp), kit de bouches pour la parole, pages de validation pour téléphone (storyboard,
  contrôle des sprites, placement) publiables en artefact claude.ai, parcours Playwright avec captures.
- **Une méthode de travail avec une IA** (`docs/fr/WORKFLOW.md`), un `CLAUDE.md`, des skills pour Claude Code et un
  gabarit de plan de production pour des sous-agents en parallèle.

## Démarrer
```bash
npm install
npm run dev                  # ouvrir l'adresse sur le téléphone (même Wi-Fi), en paysage
npm run validate             # cohérence du contenu
npm run solve                # prouve que le jeu se finit, imprime le chemin
npm test                     # tests du moteur + parcours du jeu d'exemple
npm run build                # types, tests, bundle, contrôle des spoilers, audit → dist/
```

Faire son propre jeu :
```bash
npm run new-game mon-jeu "Mon Jeu"   # games/mon-jeu depuis le gabarit, devient le jeu courant
npm run assets                       # prépare les images de remplacement
npm run dev                          # ?edit=start pour placer, ?dev&at=start pour sauter à un checkpoint
```
Puis lire `docs/fr/CONTENT_GUIDE.md` et écrire `games/mon-jeu/rooms/*.ts`. L'histoire s'écrit d'abord dans
`storyboard.json` ; `docs/fr/WORKFLOW.md` décrit toute la méthode, `docs/fr/PROMPTS.md` comment générer des images cohérentes.

## Plan du dépôt
```
src/engine/      core (DSL, moteur, solveur, validateur), dom (rendu), minigames, ending, dev (éditeur)
games/demo/      le jeu d'exemple : game.ts, rooms/, layout/, art/, audio/, storyboard.json, site.json
games/_template/ copié par npm run new-game
tools/           validate, solve, refs, assets.py, cut-sheet.py, talk-*.py, pages/, audit-assets
scripts/         harnais e2e, seal (fin scellée), gen-icons, new-game
docs/en docs/fr  ENGINE, CONTENT_GUIDE, TOOLS, WORKFLOW, PROMPTS, PAGES, PRODUCTION.template
```

## Déployer
`npm run build` produit un `dist/` statique. Le workflow CI le publie sur GitHub Pages à chaque push sur `main`.
Tout hébergeur statique convient (Clever Cloud, Netlify, un nginx). `GAME=<id> npm run build` construit un autre jeu.

## Licences
Code : MIT. Images d'exemple : CC BY 4.0 (attribution « Wano »). Bruitages : Kenney, CC0. Polices : SIL OFL. Voir `CREDITS.md`.
