# Plans d'exécution des lots 4.1.9 → 4.1.15

Un fichier par release, écrit le 7 octobre 2026 à la sortie de 4.1.8 par l'agent qui a mené 4.1.8, pour l'agent (ou la
personne) qui mènera les suivantes. La source des décisions reste `docs/dev/PLAN-4.1.8-4.1.15.md` (le programme) et le
plan directeur de la session ; ces fiches en sont l'exécution détaillée : ce qui existe déjà dans le code, ce qui
manque, les décisions tranchées, les contrats TypeScript, l'ordre des branches avec les tests à écrire avant le code,
les gates, les critères de sortie et les pièges connus. Elles sont en français comme le programme ; le CHANGELOG, le
LOG, les ADR et la doc utilisateur restent en anglais (+ français pour `docs/fr`).

| Release | Fiche | Dépend de | Durée attendue (cycles de CI) |
|---|---|---|---|
| 4.1.9 Gateways | [4.1.9-gateways.md](4.1.9-gateways.md) | 4.1.8 | 8 PR, ~2 jours de cadence |
| 4.1.10 Constellation | [4.1.10-constellation.md](4.1.10-constellation.md) | 4.1.9 | 8 PR, ~2 jours |
| 4.1.11 Viewport | [4.1.11-viewport.md](4.1.11-viewport.md) | 4.1.8 (parallélisable avec 4.1.9) | 7 PR, ~2 jours |
| 4.1.12 Language | [4.1.12-language.md](4.1.12-language.md) | 4.1.9 + 4.1.11 | 9 PR, ~3 jours |
| 4.1.13 Proof at Scale | [4.1.13-proof-at-scale.md](4.1.13-proof-at-scale.md) | 4.1.12 | 7 PR, ~3 jours (ou « Solver Research ») |
| 4.1.14 Time Attack | [4.1.14-time-attack.md](4.1.14-time-attack.md) | 4.1.10 + 4.1.12 (+ 4.1.13 pour la route logique) | 15 PR, ~4 jours |
| 4.1.15 Remix | [4.1.15-remix.md](4.1.15-remix.md) | 4.1.14 | 16 PR, ~4 jours |

## Mode d'emploi d'un lot (ce que 4.1.8 a appris)

1. **Un worktree neuf par branche**, depuis `origin/main`, jamais `git checkout main` dans le checkout principal
   (`git worktree add <scratch>/wt-<lot> -b <branche> origin/main` ; `ln -s` du `node_modules` d'un worktree frère).
2. **Une suite de tests ou un e2e à la fois sur la machine** ; chaque commande longue écrit son PID ; après une
   interruption, lister `ps -axo pid,ppid,command | awk '$2==1 && /forks.js/'` et tuer ces PID un par un (jamais
   `pkill -f`). `npm run build` refuse un chemin `/private/` : `npx vite build` dans un worktree scratch.
3. **Chaque PR** : `npm run quality`, `npm run test:node`, `npm run quality:baseline -- --check` (sans `--check` :
   ratchet, qui écrit aussi les trois chiffres des README), docs en + fr (parité testée), `docs/{en,fr}/TOOLS.md` pour
   tout script, CHANGELOG `Unreleased`, entrée LOG numérotée, `npm run audit`, trailers `Agent: Claude` +
   `Co-Authored-By` + `Claude-Session`. Puis **seconde lecture** par un sous-agent (contexte de lecture automatisé,
   pas une revue indépendante) : findings confirmés corrigés avant merge, écartés dits dans la PR.
4. **Merge** : `node tools/release/ship.mjs merge <pr>` depuis un worktree à jour (le checkout principal n'a pas
   l'outil), en `nohup`, PID dans le scratchpad. Après chaque merge sur main, les autres branches ouvertes deviennent
   `DIRTY` (CHANGELOG, LOG, `tests/quality-baseline.json`, README) : `git merge origin/main`, baseline résolue avec
   `--theirs` puis `npm run quality:baseline`, entrée LOG remise en dernier, push, relancer le watcher **après** que
   GitHub a recalculé la mergeabilité (`gh pr view --json mergeStateStatus` ≠ `UNKNOWN`). Le lot 0 de 4.1.9 supprime
   ces conflits (fragments de CHANGELOG et de LOG par branche).
5. **Mutation** : le job `mutation` ne tourne que quand `inputHash` change ; il dure ~50 min sur le runner. Un
   survivant non nommé fait échouer : soit un test qui le tue (préféré), soit une entrée `docs/dev/mutants.json` avec
   `context` et `why`, puis `npx tsx tools/mutate.ts --doc`.
6. **Release** : branche `release/x.y.z` ; version (`npm version x.y.z --no-git-tag-version`), golden save
   (`npx tsx tools/golden-save.ts x.y.z` + la liste de `tests/save-v3.test.ts`), CHANGELOG `## x.y.z — date`,
   ROADMAP en/fr (section « shipped »), UPGRADING §n, `docs/dev/passes/x.y.z.md`, `docs/dev/baselines/x.y.z.md`
   (mesures vs précédente, sources nommées), LOG ; PR, seconde lecture, merge ; puis **le candidat** (4.1.17) :
   `gh workflow run candidate -f sha=<sha complet>`, attendre que `candidate-gate` soit vert et noter l'id du run
   (son résumé donne la commande) ; puis `node tools/release/ship.mjs tag x.y.z-rc.1 <sha> --candidate=<run>`
   (pré-release), observation (archives installées hors dépôt, `fresh-install`, `upgrade-check --from=<précédente>`,
   golden saves, les `.wsrun` du candidat), puis `ship tag x.y.z <sha> --candidate=<run>` sur le même SHA,
   `ship verify x.y.z`. Une nouvelle RC sur un autre SHA demande un nouveau candidat. `ship tag` refuse sans candidat
   vert de ce SHA ; release.yml publie les fichiers de ce run après vérification de leurs sommes. Le nightly qui suit
   le tag est un audit, pas une condition : s'il rougit, alerte et, au besoin, une version corrective. Un tag publié ne
   bouge jamais ; un tag non publié peut être supprimé.
7. **Honnêteté** : jamais `proved`, `verified`, `delivered` quand un budget a été coupé ; les passes humaines
   consignées « not done » (D12) ; chaque mesure nomme sa source (run CI, commande locale, date).

## Lot 0 (début de 4.1.9) : la cadence elle-même

Mesuré le 7 octobre 2026 (analyse de l'utilisateur sur les runs GitHub) : 20 jobs par PR, 17 checks requis, une CI verte en
11–19 min pour 59–61 runner-minutes, 26 annulations sur les 50 derniers runs, le job `mutation` tenant un run une
heure. Hors mutation, le job le plus long est `reference (chromium)` (~11 min) : une boucle PR sous dix minutes est
réaliste. Le lot 0 met la CI en **trois niveaux** et supprime les conflits entre branches :

1. **Fragments de CHANGELOG et de LOG** (fait : PR #39, `changes/README.md`, `npm run changes -- --check|--assemble`).
2. **Mutation hors du chemin PR** (fait dans PR #32 : `main`, nuit, `release-check` avec le rapport en cache, et une PR
   étiquetée `full-ci` seulement).
3. **Niveau « PR rapide »** (un job Node 22, verdict en 5–8 min) : format, lint, knip, types ; `test:coverage` une
   seule fois (plus de `test:node` séparé) ; `build:game` (pas `build`, qui relance `check` et la suite) ; validate,
   solve, lint de contenu, baseline ; **ratchet de couverture en avertissement** (strict la nuit et à la release) ;
   `audit:deps` seulement si `package-lock.json` change ; un job Chromium ciblé si moteur, jeu, rendu ou scripts e2e
   ont changé. Supprimer les doubles exécutions `quality → build → check` et `test:node → coverage`, et les
   `npm ci` + Playwright + build répétés par chaque ligne e2e (un job `build` partagé, artefact `dist/`).
4. **Niveau « gate complet »** (merge queue si disponible, sinon push sur `main`, interdiction de taguer tant qu'il
   n'est pas vert) : e2e regroupés **par navigateur** (Chromium : full + clavier + fr + canvas ; WebKit : generic +
   clavier ; référence Chromium et WebKit ; Reality ; PWA ; packaging ; migration ; Windows) avec
   `continue-on-error` par étape et un récapitulatif en fin de job, pour ne pas masquer un second défaut derrière le
   premier.
5. **Niveau « nuit / release »** : mutation, corpus, preuves lourdes, audits stricts, ratchet strict.
6. **Sélection par chemins** : un job `plan` (script versionné et testé, `tools/ci-plan.ts`, pas d'action tierce)
   classe le diff : `docs/**` → liens et format ; `bridge/**`, `games/signals/**` → Reality ; sauvegardes, migrations,
   schémas → `upgrade` ; template, packaging, exports → `second-game`, `fresh-install` ; rendu, DOM, Canvas → visuel
   et performance ; audio → musique ; PWA, Vite, service worker → matrice PWA ; moteur partagé → gate complet.
7. **Un seul check requis, `pr-gate`** : un job agrégateur (`if: always()`) vérifie que tous les contrôles prévus par
   le plan ont réussi ; le ruleset remplace ses 17 noms par celui-là (geste de l'utilisateur, après quelques runs
   verts de `pr-gate`). Un échec rapide du niveau 1 annule les niveaux suivants (`needs:` + annulation).
8. **Accélération de la release** (lot séparé annoncé par le programme §4) : `release.yml` déclenché par le push du
   tag, vérifiant par l'API que le run `ci` de `main` sur ce SHA exact est `success` (sinon refus) au lieu de refaire
   la CI sur le tag ; **la garantie « le tag est le commit testé » reste** (SHA strict, workflow attendu, conclusion,
   branche d'origine, pas de release existante, provenance de l'artefact). Le fast-forward reste soumis à la charte et
   au ruleset.
- Cibles : PR ordinaire sous 8 min, échec signalé sous 5 min, moins de 15 runner-minutes par itération, suite
  exhaustive une seule fois avant intégration ou release ; merge → release publiée ≈ 25 min au lieu de 45–50.
- Ordre sûr : 1 et 2 (faits) → 3 (dédoublonner, ratchet en avertissement) → 6 et 7 (`plan`, `pr-gate` en observation)
  → ruleset → 4 (gate complet en merge queue ou sur `main`) → 8. Le brouillon des jobs, du script `plan` et de
  l'agrégateur : [4.1.9-lot0-ci.md](4.1.9-lot0-ci.md).
