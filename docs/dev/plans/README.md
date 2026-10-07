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
   (mesures vs précédente, sources nommées), LOG ; PR, seconde lecture, merge ; puis
   `node tools/release/ship.mjs tag x.y.z-rc.1 <sha>` (pré-release), observation (archives installées hors dépôt,
   `fresh-install`, `upgrade-check --from=<précédente>`, golden saves), puis `ship tag x.y.z <sha>` sur le même SHA,
   `ship verify x.y.z`. Un tag publié ne bouge jamais ; un tag non publié peut être supprimé.
7. **Honnêteté** : jamais `proved`, `verified`, `delivered` quand un budget a été coupé ; les passes humaines
   consignées « not done » (D12) ; chaque mesure nomme sa source (run CI, commande locale, date).

## Lot 0 (début de 4.1.9) : la cadence elle-même

Avant le premier connecteur, une PR `feature/419-cadence` :

- **Fragments de CHANGELOG et de LOG** : chaque branche écrit `changes/<branche>.md` (une section `### Fixed|Changes|
  Breaking` + le texte) et `changes/<branche>.log.md` (le corps de l'entrée LOG, sans numéro) ; `npm run changes --
  --assemble` (nouveau script `tools/changes.ts`) les insère dans `CHANGELOG.md` `Unreleased` et numérote les entrées
  LOG dans l'ordre des merges (date du merge), à la release ou à la demande ; un test vérifie qu'une PR qui touche
  `src/`, `bridge/` ou `tools/` a un fragment. Plus de conflit entre branches ouvertes.
- **Mutation en deux jobs** : `mutation (core)` et `mutation (reality)` en matrice (le ruleset ne requiert pas `mutation`
  par son nom : `gh api repos/wanoo/web-scumm/rulesets/24580261`), chacun son `inputHash` et son cache ; ~25 min au
  lieu de 50.
- **Accélération de release** (lot séparé annoncé par le programme §4) : `release.yml` déclenché par le push du tag,
  vérifiant par l'API que le run `ci` de `main` sur ce SHA exact est `success` (sinon refus), au lieu de refaire la CI
  sur le tag (−12 min) ; un job `build` partagé par les lignes e2e (−3 min). Le fast-forward reste soumis à la charte
  et au ruleset (décision de l'utilisateur, pas de l'agent).
- Mesure attendue : merge → release publiée ≈ 25 min au lieu de 45–50.
