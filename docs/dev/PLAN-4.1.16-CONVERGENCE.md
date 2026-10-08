# web-scumm 4.1.16 — Convergence

> **Statut : proposition de correctif après la publication de v4.1.15 « Remix ».**  
> **Base fonctionnelle :** tag `v4.1.15`, commit `35b4143a5c6058bc65dd46f92f2547ac00df35f3`.  
> **Nature :** fermeture des contrats transversaux, qualité et exploitation ; aucune nouvelle mécanique de jeu.  
> **Branche recommandée :** `feature/4116-convergence`.  
> **But :** faire fonctionner ensemble les capacités déjà publiées avant de présenter web-scumm 4.2 comme stable.  
> **Révision 2 (8 oct 2026)** : relu contre le code de `v4.1.15` (corrections marquées « Révision 2 », annexe §21) ;
> décisions du mainteneur : périmètre complet, D29 + ADR 0019 pour `SpeedrunCategory.world`, cinq PR
> (`docs/dev/plans/4.1.16-convergence.md`).

## 1. Décision de version

La 4.1.15 livre deux sous-systèmes solides lorsqu'ils sont utilisés séparément :

- Time Attack enregistre, reprend et vérifie une course déterministe ;
- Remix construit, sauvegarde, rejoue et prouve des mondes déterministes.

Leur composition n'est cependant pas fermée. Une session et une sauvegarde connaissent leur `WorldVariant`, mais
l'enveloppe `.wsrun` schema 1 ne transporte que la seed du PRNG de la course. Le recorder traite `daily` et `mystery`
comme une nouvelle seed aléatoire, le vérificateur rejoue le jeu de base, `worldVerdict` n'est pas appelé et le Bridge
ne distingue que `fixed` de `random`.

La 4.1.16 ne doit pas ajouter une neuvième grande capacité. Elle doit rendre vraies, de bout en bout, les promesses
déjà publiées :

```text
monde choisi
  → partie jouée
  → session enregistrée
  → .wsrun exporté
  → worker isolé
  → replay dans le même monde
  → verdict de catégorie
  → classement correspondant
```

La 4.1.16 reste compatible avec les sauvegardes v3/v4 et les `.wsrun` schema 1. Elle peut ajouter des champs au DSL,
mais ne change pas le sens d'un contenu 4.1.15 valide. Les anciens runs sont interprétés comme des runs du monde
Story ; ils ne sont jamais requalifiés silencieusement comme runs Remix.

## 2. Baseline à conserver

Avant le premier changement, archiver les résultats du tag exact `v4.1.15` :

- CI du tag verte sur Node 22/24, Windows, Chromium, WebKit et Firefox PWA ;
- `npm audit` sans vulnérabilité connue ;
- environ 1 868 tests et ratchet de couverture strict ;
- bundle initial mesuré à 132 KB gzip pour `demo` et 137 KB pour `reference`, budget 140 KB ;
- `e2e:remix` : mêmes 200 résultats dans Node, Chromium, WebKit et Firefox ;
- `e2e:speedrun` : 21 vecteurs et le run de référence identiques dans les quatre runtimes, reprise après un chunk ;
- **Révision 2** : ces deux E2E n'avaient jamais tourné avant le 8 octobre (ni en CI ni localement, LOG #137/#138) ;
  mesurés ce jour-là sur `v4.1.15` (`docs/dev/baselines/4.1.16-start.md`), ils passent tels qu'écrits ci-dessus.
  `e2e:canonical` (4.1.12), jamais exécuté non plus, **échoue dans Firefox** : `String.prototype.normalize('NFC')`
  y remplace une demi-paire de substitution isolée par U+FFFD, que Chromium, WebKit et Node conservent, donc
  `canonicalJson` n'écrit pas le même texte. Corrigé dans le lot B (PR 2), bloquant en CI au lot F ;
- démo : trois mondes de catalogue résolus ;
- référence : vingt-quatre mondes logiques résolus dans les modes Remix, Daily et Mystery ;
- artefacts de release, SBOM, checksums et rapports Remix conservés comme oracles.

Ajouter une fixture rouge démontrant le défaut avant de le corriger : une course jouée dans un monde où un objet ou
un acteur a changé de place doit échouer ou diverger avec le vérificateur 4.1.15, parce que celui-ci rejoue le monde
Story. Cette fixture devient le premier test vert de la 4.1.16.

## 3. Principes non négociables

1. **Une notion, un champ.** La seed du PRNG d'une course et la seed d'un monde Remix ne sont plus confondues.
2. **Le monde fait partie de la preuve.** Une course n'existe pas indépendamment du monde exact joué.
3. **Aucune confiance implicite.** Toute variante ou preuve reçue commence comme `unknown` et est validée.
4. **Compatibilité explicite.** Schema 1 reste lisible comme Story ; schema 2 porte un monde.
5. **Un verdict unique.** CLI, MCP, worker, Bridge et Studio utilisent le même vérificateur et les mêmes codes.
6. **Aucune requalification silencieuse.** Changer règles, monde ou catégorie crée une autre clé de classement.
7. **Intégrité n'est pas authenticité.** Un replay local cohérent n'est pas déclaré `server-witnessed`.
8. **Daily et Mystery ne mentent pas.** Une preuve absente ou non authentifiable ne devient jamais un run classé.
9. **Les tests traversent les frontières.** Tester deux helpers séparément ne prouve pas qu'ils sont raccordés.
10. **Pas de réécriture générale.** Chaque lot doit rester révisable, mesuré et réversible.

## 4. Contrat cible : course et monde séparés

### 4.1 Catégorie de speedrun

Le champ historique `SpeedrunCategory.seed` décrit le PRNG de la course. Il reste accepté pour compatibilité, mais ne
doit plus porter implicitement la politique du monde.

Ajouter un contrat distinct :

```ts
interface SpeedrunWorldPolicy {
  policy: 'story' | 'fixed' | 'random' | 'daily' | 'mystery';
  mode: string;
  fixedSeed?: string;
  codeWheel?: {
    enabled: boolean;
    skip: boolean;
    medium: 'digital' | 'physical' | 'either';
  };
}

interface SpeedrunCategory {
  // Contrat 4.1.14 conservé : seed du PRNG de la course.
  seed?: 'fixed' | 'random' | 'daily' | 'mystery';
  // Nouveau contrat explicite : monde dans lequel la course doit être jouée.
  world?: SpeedrunWorldPolicy;
}
```

Normalisation à la compilation :

- absence de `world` : monde Story, comportement des catégories 4.1.14 ;
- `seed: 'daily'` historique sans `world` : normalisé vers PRNG `random` et monde `daily` avec avertissement de
  dépréciation ;
- `seed: 'mystery'` historique sans `world` : même migration vers le monde `mystery` ;
- `world.policy === 'fixed'` exige `fixedSeed` ;
- Daily exige `game.remix.daily` et une clé publique ;
- Mystery exige un mode Remix et une configuration Bridge ;
- Story refuse une variante logique non Story ;
- le validateur refuse les combinaisons impossibles plutôt que d'en inventer le sens.

La documentation de stabilité doit reconnaître cette correction additive : les champs 4.1.15 restent acceptés, mais
la séparation `seed` / `world` devient la forme canonique avant le gel 4.2.

### 4.2 `.wsrun` schema 2

Introduire une nouvelle enveloppe sans supprimer schema 1 :

```ts
interface SpeedrunEnvelopeV2 {
  format: 'web-scumm-speedrun';
  schema: 2;
  gameId: string;
  fingerprint: GameFingerprint;
  engineVersion: string;
  prngVersion: number;
  timingVersion: number;
  categoryId: string;
  rulesVersion: number;

  /** Seed du PRNG logique de la course, distincte de la seed du monde. */
  runSeed: string;

  /** Monde exact joué, affectations incluses, jamais régénéré à partir de la seule seed. */
  variant: WorldVariant;

  /** Preuves signées nécessaires à la politique du monde. */
  worldEvidence?: SpeedrunWorldEvidence;

  timing: SpeedrunTiming;
  splits: readonly RecordedSplit[];
  chunks: readonly EnvelopeChunk[];
  loads?: readonly RunLoad[];
  inputsUsed?: readonly SpeedrunInput[];
  realitySignals?: readonly RecordedRealitySignal[];
  h0: string;
  finalStateHash: string;
  finalProof: string;
  trust: TrustLevel;
}
```

`h0` doit sceller au minimum :

- empreinte du jeu et composants exigés par la catégorie ;
- catégorie et version de règles ;
- `runSeed` ;
- hash complet du `WorldVariant` ;
- politique du monde ;
- hash canonique des preuves Daily/Mystery ;
- versions PRNG, timing, enveloppe et algorithme Remix.

Le `finalProof` continue de sceller la chaîne et le résumé final. Modifier le monde, les preuves ou la catégorie doit
changer `h0` et rendre toute ancienne chaîne invalide.

### 4.3 Compatibilité schema 1

Le parseur accepte les deux schemas :

- schema 1 : `seed` devient `runSeed`, monde Story calculé depuis le manifeste approuvé ;
- schema 1 + tentative de classement Remix : `valid-unranked` ou refus explicite `legacy-world-missing` ;
- schema 2 : `variant` obligatoire et vérifié intégralement ;
- aucune conversion ne devine un monde Remix depuis la seule seed ;
- le `.wsrun` de référence 4.1.14/4.1.15 reste vérifiable ;
- l'export écrit uniquement schema 2 à partir de 4.1.16.

Ajouter des golden fixtures schema 1 et 2. Leur sens doit rester stable dans les versions suivantes.

## 5. Lot A — Recorder et journal

### 5.1 Capturer le monde actif

Le recorder reçoit explicitement :

- le `WorldVariant` appliqué au `GameDef` ;
- la politique normalisée de la catégorie ;
- les preuves Daily/Mystery vérifiées au démarrage ;
- la seed du PRNG de course.

Il ne génère jamais une nouvelle seed de monde. Pour une catégorie Daily ou Mystery, le monde doit déjà avoir été
obtenu du Bridge et appliqué avant le départ du chronomètre.

### 5.2 Départ atomique

Le départ d'une course scelle en une opération logique :

```text
game fingerprint
+ category rules
+ run seed
+ world variant
+ world evidence
+ start timestamp/evidence
→ h0
```

Une erreur de stockage, de preuve ou de monde empêche le départ classable et affiche une raison. Elle ne démarre pas
une course qui sera découverte invalide à l'arrivée.

### 5.3 Reprise

Le checkpoint du recorder conserve `variant`, `worldEvidence`, `runSeed` et `h0`. À la reprise :

- le jeu reconstruit le même monde avant de restaurer l'état ;
- la catégorie et ses règles n'ont pas changé ;
- les chunks existants repartent du même `h0` ;
- un autre monde, même avec un état apparemment compatible, est refusé ;
- une reprise après redémarrage produit le même `finalProof`.

### Critère de sortie

Une course Remix interrompue après un chunk, reprise dans un nouveau processus puis terminée produit une enveloppe
schema 2 valide et le même verdict sur les quatre runtimes.

## 6. Lot B — Vérificateur unique

Le chemin du vérificateur devient strictement :

1. parser l'enveloppe ;
2. vérifier versions et empreintes ;
3. normaliser schema 1 ou schema 2 ;
4. compiler le manifeste approuvé ;
5. appeler `loadVariant` sur le monde stocké ;
6. vérifier `worldVerdict` avec les preuves authentifiées ;
7. appliquer le monde au jeu approuvé ;
8. recalculer `h0` ;
9. rejouer les entrées avec `runSeed` ;
10. comparer tirages, digests, splits, temps, état final, chunks et preuve finale ;
11. produire le verdict et la clé de classement.

Étendre le résultat :

```ts
interface SpeedrunVerifyResult {
  verdict: SpeedrunVerdict;
  code: string;
  reason: string;
  trust: TrustLevel;
  world?: {
    hash: string;
    mode: string;
    seed: string;
    leaderboardKey: string;
  };
  recomputed?: RecomputedRun;
}
```

Codes minimum à tester :

- `world-missing` ;
- `world-shape` ;
- `world-hash` ;
- `world-stale` ;
- `world-value` ;
- `world-constraint` ;
- `world-policy` ;
- `daily-proof-missing` ;
- `daily-proof-invalid` ;
- `mystery-commitment` ;
- `mystery-reveal` ;
- `mystery-start-window` ;
- `legacy-world-missing` ;
- `leaderboard-key`.

CLI, JSON, MCP, Studio et worker Bridge exposent les mêmes champs et codes.

### Critère de sortie

Deux courses aux actions identiques dans deux mondes différents ont deux `h0`, deux preuves et deux clés de
classement différentes. Une enveloppe à laquelle seule la variante est substituée est refusée avant le replay.

## 7. Lot C — Daily et Mystery authentifiables

### 7.1 Preuves transportées

Définir des preuves versionnées et strictes :

```ts
type SpeedrunWorldEvidence =
  | { kind: 'daily'; token: string }
  | {
      kind: 'mystery';
      commitmentToken: string;
      revealToken: string;
    };
```

Le token Daily doit lier : jeu, date, seed, mode, règles, version d'algorithme et fenêtre de validité.

Le Bridge doit désormais signer la révélation Mystery. `revealToken` lie :

- identifiant du commitment ;
- jeu ;
- seed ;
- nonce ;
- mode ;
- `revealedAt` ;
- commitment original.

Une réponse JSON non signée n'est jamais une preuve de classement.

### 7.2 Limite d'authenticité

Un client local peut mentir sur l'instant exact où il a commencé. La 4.1.16 ne doit pas appeler cela
`server-witnessed`.

Politique :

- Story, Fixed, Random et Daily peuvent être `replay-valid` lorsque leurs preuves sont valides ;
- Mystery sans témoin serveur peut être vérifié localement mais reste `valid-unranked` sur un leaderboard public ;
- une future preuve `server-witnessed` pourra classer Mystery sans modifier l'enveloppe schema 2 ;
- cette limite est affichée dans le joueur, le vérificateur et le Bridge.

### 7.3 Validation des routes

- dates strictes `YYYY-MM-DD`, UTC valide ;
- limite de rétention des anciennes journées ;
- taille maximale des tokens et corps ;
- `gameId`, mode et `kid` allowlistés ;
- rotation de clé testée ;
- mauvais tenant, mauvais jeu, date future, token expiré et rejeu refusés ;
- aucune clé privée dans une sauvegarde, session ou enveloppe.

## 8. Lot D — Bridge Runs durable et cohérent

### 8.1 Clé de classement

Le worker renvoie la clé calculée par le vérificateur. Le serveur ne la reconstruit pas à partir d'un `seedKind`
réduit.

```ts
interface RunRecord {
  worldHash: string;
  worldMode: string;
  worldSeed: string;
  leaderboardKey: string;
}
```

Séparation attendue :

- Story : catégorie Story ;
- Fixed : catégorie + seed publiée ;
- Random : catégorie commune si ses règles déclarent les seeds comparables ;
- Daily : catégorie + seed/date signée ;
- Mystery : catégorie commune, mais non classée sans témoin serveur.

Les égalités retournent le même rang et le tri est stable par temps, date puis identifiant.

### 8.2 Stores asynchrones

Remplacer les magasins synchrones ou uniquement mémoire de Daily et Runs par des interfaces asynchrones :

```ts
interface DailyStore {
  get(key: string): Promise<string | undefined>;
  putIfAbsent(key: string, value: string): Promise<string>;
}

interface RunStore {
  create(run: RunRecord): Promise<void>;
  claimNext(workerId: string, leaseMs: number): Promise<RunRecord | undefined>;
  complete(id: string, result: WorkerResult): Promise<void>;
  recoverExpiredLeases(now: number): Promise<number>;
}
```

Fournir mémoire pour tests, SQLite pour local et PostgreSQL pour distribution. Révision 2 : la couche existe déjà,
`SqlDb.tx(lockKey)` (SQLite `BEGIN IMMEDIATE`, PostgreSQL verrou consultatif) avec ses motifs CAS
(`UPDATE … WHERE claimed = 0` puis une ligne exactement) et `INSERT … ON CONFLICT DO NOTHING`
(`bridge/src/store-sql.ts`) ; Daily et Runs s'écrivent dessus, sans nouvelle abstraction. Les écritures concurrentes utilisent
CAS, contrainte unique ou transaction ; jamais un `get` suivi d'un `put` non atomique.

### 8.3 Montage et récupération

- monter Daily et Runs dans le serveur principal sous configuration explicite ;
- partager tenant, authentification, CORS, quotas et journal d'audit ;
- récupérer les jobs `queued` ou `verifying` dont le lease a expiré ;
- borner file, taille des enveloppes, nombre de workers, mémoire et durée ;
- conserver les runs après redémarrage ;
- empêcher deux workers de vérifier le même job simultanément ;
- tester deux instances contre PostgreSQL.

### 8.4 Isolation du worker

Le monkeypatch réseau reste une défense en profondeur, pas une sandbox. Fournir un profil de déploiement :

- conteneur sans privilège ;
- root filesystem en lecture seule ;
- répertoire temporaire borné ;
- aucune clé ou secret Bridge dans l'environnement ;
- réseau désactivé ;
- limites CPU, mémoire, processus et temps ;
- kill du groupe complet ;
- logs bornés et expurgés.

### Critère de sortie

Deux instances Bridge, trois workers et PostgreSQL reçoivent deux fois le même `.wsrun` : un seul run canonique est
créé, un seul worker le vérifie, le résultat survit au redémarrage et apparaît dans une seule clé de classement.

## 9. Lot E — Code wheel réellement intégré

Le générateur et les tests purs sont conservés. Fermer les chemins joueur :

- le runner écoute `mg-record` ;
- un résultat générique de minijeu est enregistré dans la session et le journal sémantique ;
- replay et Time Attack reproduisent ou vérifient le résultat ;
- `won`, `passed`, `skipped` et `failed` restent distincts ;
- les rotations détaillées peuvent rester de la télémétrie, mais la décision narrative est contractuelle ;
- boutons, flèches, Tab, Entrée, Échap et manette couvrent tout le parcours ;
- la manette peut sélectionner et confirmer une réponse, pas seulement tourner ;
- le focus revient à la scène à la fin ;
- `prefers-reduced-motion` est testé dans un vrai navigateur ;
- axe teste la roue et sa liste textuelle ;
- la roue imprimée et l'alternative textuelle produisent la même solution.

Le mode parodique qui laisse passer après plusieurs erreurs ne doit pas être enregistré comme une victoire. Une
catégorie peut autoriser `passed`, exiger `won`, autoriser une roue physique ou désactiver la roue.

### Critère de sortie

Le jeu de référence termine la roue au clavier et à la manette dans Chromium et WebKit ; la session exportée distingue
la victoire du passage parodique et le vérificateur applique la règle de catégorie correspondante.

## 10. Lot F — Gates CI manquants

Créer trois commandes bloquantes :

```text
npm run e2e:remix
npm run e2e:speedrun
npm run e2e:remix-speedrun
```

`e2e:remix-speedrun` doit, pour chaque politique de monde :

1. construire le monde par le vrai chemin joueur ;
2. démarrer le vrai recorder ;
3. jouer ou alimenter une route réelle ;
4. fermer et exporter l'enveloppe ;
5. la parser dans un nouveau processus ;
6. la vérifier dans le worker ;
7. la soumettre au Bridge ;
8. vérifier sa clé de classement et son niveau de confiance.

Matrice minimale :

| Cas | Node | Chromium | WebKit | Firefox |
|---|---:|---:|---:|---:|
| déterminisme Remix | oui | oui | oui | oui |
| replay Time Attack | oui | oui | oui | oui |
| Story schema 2 | oui | oui | oui | nuit |
| Fixed Remix | oui | oui | oui | nuit |
| Random Remix | oui | oui | oui | nuit |
| Daily signé | oui | oui | oui | nuit |
| Mystery engagé/révélé | oui | oui | oui | nuit |
| reprise après chunk | oui | oui | oui | nuit |
| code wheel clavier | oui | oui | oui | nuit |
| code wheel manette | oui | oui | oui | nuit |

Le job rapide compare tous les runtimes. Les parcours complets Firefox peuvent rester nocturnes si Firefox PWA reste
bloquant à chaque release.

### Mutation testing

Ajouter :

```text
mutation:remix
mutation:speedrun
mutation:remix-speedrun
```

Inclure au minimum :

- seed code et normalisation ;
- hash de variante ;
- compilation et application ;
- contraintes ;
- catégories et `worldVerdict` ;
- enveloppes et `h0` ;
- recorder et reprise ;
- vérificateur ;
- clé de classement ;
- validation des preuves Daily/Mystery.

Une fonction publique de sécurité ou de classement qui n'est appelée que par son propre test doit être détectée par
un test d'intégration ou supprimée de la promesse publique.

## 11. Lot G — Release et provenance

### 11.1 Filiation Git

`v4.1.14` et `v4.1.15` ne forment pas actuellement une ligne d'ascendance stricte. Ne réécrire aucun tag publié.

Sur la branche 4.1.16 :

- fusionner le commit du tag `v4.1.14` dans l'histoire issue de `v4.1.15` ;
- résoudre le conflit de seuils en conservant les seuils les plus stricts ;
- vérifier que `git merge-base --is-ancestor v4.1.14 HEAD` et `v4.1.15 HEAD` réussissent ;
- faire échouer une future release si le tag stable précédent n'est pas ancêtre du nouveau tag.

### 11.2 Déploiement Pages

Pages dépend du gate terminal, pas d'un sous-ensemble :

```yaml
pages:
  needs: [pr-gate]
```

Aucun déploiement n'est créé lorsque Firefox PWA, mutations, preuves, référence ou intégration Remix/Time Attack
échoue.

### 11.3 Artefacts

La release joint :

- un `.wsrun` schema 1 historique vérifié ;
- un `.wsrun` schema 2 Story ;
- un Fixed Remix ;
- un Daily avec preuve signée ;
- un Mystery explicitement `valid-unranked` sans témoin serveur ;
- rapports de preuve des catalogues ;
- SBOM, checksums et provenance ;
- rapport des E2E multiruntime.

Signer le tag lorsque la clé du mainteneur est disponible. L'attestation GitHub des artefacts reste obligatoire.

## 12. Lot H — Documentation vérifiable

Corriger les contradictions connues :

- sauvegardes schema 4 dans ARCHITECTURE et SUPPORT ;
- `.wsrun` schema 2 et règle de lecture schema 1 ;
- différence entre `runSeed` et `WorldVariant.seed` ;
- appel réel de `worldVerdict` ;
- clé réelle de leaderboard ;
- modules Bridge montés ou explicitement expérimentaux ;
- limites de Mystery sans témoin serveur ;
- nature des rapports de preuve ;
- support navigateur prouvé et support seulement manuel.

Ajouter `npm run docs:truth`, qui vérifie au minimum :

- version du package et version affichée ;
- schemas de sauvegarde, session, `.wsrun`, IR et WorldVariant ;
- scripts documentés présents dans `package.json` ;
- capacités marquées « production » réellement montées ;
- commandes et exports cités existants ;
- liens de release correspondant au tag ;
- compteurs générés plutôt que saisis à la main.

Les notes de release sont générées après le tag testé. `main` peut dire « next 4.1.16 », mais ne devient « current
release » qu'après publication réussie.

## 13. Lot I — Dette technique bornée

### Vite 8

- éliminer ou expliquer tous les avertissements d'imports incompatibles avec le loader natif futur ;
- choisir et documenter le `configLoader` ;
- appliquer les changements d'imports par codemod dans un commit mécanique séparé ;
- vérifier Node 22, Node 24, Windows et les packages installés hors dépôt.

### Bundle

- ne pas relever le budget de 140 KB ;
- viser au plus 130 KB gzip pour le jeu de référence ;
- garder compiler Remix, Studio, preuves, Bridge et outils hors du chunk initial ;
- charger Daily, code wheel et menus Remix seulement lorsqu'ils sont utilisés ;
- mesurer transfert réel, pas seulement taille du fichier produit.

### Fichiers centraux

Découper uniquement lorsqu'un lot les modifie :

- `validate.ts` par domaine, dont `validate/remix.ts` et `validate/speedrun.ts` ;
- worker, parsing et classement dans des modules distincts ;
- ne pas mélanger refactoring, formatage et correction fonctionnelle dans un même commit.

## 14. Ordre de mise en œuvre recommandé

1. **`test(4116): reproduce Remix run verified in Story`** — fixture rouge de bout en bout.
2. **`chore(release): restore 4.1.14 ancestry`** — fusion non destructive des histoires publiées.
3. **`feat(speedrun): separate run seed from world policy`** — normalisation du DSL et validation.
4. **`feat(speedrun): add wsrun schema 2 world binding`** — types, parser, export et fixtures.
5. **`fix(speedrun): record the engine's active world`** — recorder, checkpoint et reprise.
6. **`fix(speedrun): replay and judge the sealed world`** — `loadVariant`, `applyVariant`, `worldVerdict`.
7. **`fix(bridge): rank by verified world key`** — worker et leaderboard.
8. **`feat(daily): sign reveal evidence`** — preuves strictes et limites d'authenticité.
9. **`feat(bridge): durable daily and run stores`** — mémoire, SQLite, PostgreSQL et récupération.
10. **`fix(minigame): journal code-wheel outcomes`** — replay, règles et manette complète.
11. **`test(e2e): gate Remix and Time Attack together`** — trois E2E et navigateurs.
12. **`test(mutation): gate remix and speedrun contracts`** — nouveaux ensembles de mutants.
13. **`fix(ci): deploy pages only after pr-gate`** — déploiement terminal.
14. **`docs(4116): align contracts and generated facts`** — `docs:truth` et guides.
15. **`chore(4116): remove Vite warnings and recover bundle margin`** — commits mécaniques séparés.

Chaque commit logique ajoute d'abord son test rouge, ne modifie qu'un contrat principal et se termine par les sorties
exactes des commandes pertinentes.

## 15. Matrice de tests obligatoire

### Enveloppes et compatibilité

- schema 1 Story accepté ;
- schema 1 Remix refusé ou non classé explicitement ;
- schema 2 Story, Fixed, Random, Daily et Mystery ;
- champ manquant, type incorrect et champ supplémentaire refusés ;
- variant modifié sans hash recalculé refusé ;
- variant forgé avec hash recalculé mais valeur hors domaine refusé ;
- changement de catégorie, règles, preuve ou monde casse `h0` ;
- sauvegardes v3/v4 et `.wsrun` v1/v2 testés indépendamment.

### Replay et classement

- même run + même monde = même preuve sur quatre runtimes ;
- même run + autre monde = refus ;
- Fixed de deux seeds = deux classements ;
- deux Random = classement commun seulement si déclaré comparable ;
- deux jours Daily = deux classements ;
- Daily à mauvaise date ou mauvais jeu = refus ;
- mauvais commitment ou reveal Mystery = refus ;
- Mystery local sans témoin = non classé ;
- égalité de temps = même rang ;
- déduplication d'une soumission répétée.

### Stockage et concurrence

- crash avant et après chaque écriture ;
- reprise d'un worker mort ;
- deux instances réclamant le même job ;
- SQLite occupé ;
- transaction PostgreSQL annulée ;
- file pleine ;
- enveloppe trop grosse ;
- purge et rétention ;
- séparation stricte entre deux tenants.

### Accessibilité

- axe sans violation sérieuse ou critique sur menu Remix, conflit de monde et code wheel ;
- parcours complet clavier ;
- parcours complet manette ;
- focus restauré ;
- annonces de rotation, réponse et résultat ;
- mouvement réduit ;
- liste textuelle utilisable sans la représentation visuelle.

## 16. Commandes de vérité

La branche n'est publiable que si ces commandes passent sur le checkout propre et les archives produites :

Révision 2 : à `v4.1.15`, `test:mutation:reality` n'existe pas (on lance `test:mutation:core -- --set=reality`) ;
`test:mutation:remix`, `test:mutation:speedrun`, `e2e:remix-speedrun` et `docs:truth` sont à créer (lots F et H) ;
toutes les autres commandes existent.

```text
npm run doctor -- --release
npm run quality
npm run test:node
npm run test:assets
npm run verify:game
npm run verify:variants -- --prove
npm run e2e:remix
npm run e2e:speedrun
npm run e2e:remix-speedrun
npm run e2e:a11y
npm run e2e:pwa
npm run test:mutation:core
npm run test:mutation:reality
npm run test:mutation:remix
npm run test:mutation:speedrun
npm run fresh-install
npm run upgrade-check -- --from=v4.1.15
npm run docs:truth
npm run release-check
```

Le release workflow refait ou vérifie les gates contractuelles ; il ne se contente pas d'une CI verte sur un autre
commit.

## 17. Critères de sortie de la 4.1.16

La 4.1.16 ne doit pas être taguée tant que l'un des points suivants reste vrai :

- un `.wsrun` Remix ne transporte pas son monde exact ;
- la seed du PRNG de course et la seed du monde sont encore confondues ;
- le vérificateur rejoue le jeu Story à la place du monde scellé ;
- `worldVerdict` ou `leaderboardKey` ne sont pas dans le chemin réel de production ;
- Daily et Mystery sont convertis en `random` par le worker ;
- une preuve Daily/Mystery est une simple affirmation non signée ;
- un run schema 1 peut être requalifié silencieusement comme Remix ;
- `e2e:remix`, `e2e:speedrun` ou leur composition ne sont pas bloquants ;
- le code wheel ne peut pas être terminé au clavier et à la manette dans un vrai navigateur ;
- son résultat narratif n'est pas présent dans session et replay ;
- un redémarrage perd les jobs ou commitments annoncés comme durables ;
- Pages peut être déployé avec `pr-gate` rouge ;
- `v4.1.14` et `v4.1.15` ne sont pas ancêtres du candidat ;
- les documents affirment une capacité que le chemin de production n'appelle pas ;
- le bundle du jeu de référence dépasse 140 KB gzip ;
- le tag, les artefacts et le commit testé ne sont pas identiques.

## 18. Passes humaines

Les passes humaines restent rapportées selon D12 en 4.1.16, mais elles deviennent des prérequis à la déclaration de
stabilité 4.2 :

- cinq graines Remix du jeu de référence jouées jusqu'à la fin ;
- Daily joué le même jour sur deux appareils, monde et code identiques ;
- roue imprimée utilisée à une table ;
- alternative de la roue testée par une personne utilisant un lecteur d'écran ;
- trois speedrunners soumettent des runs Story, Remix et Daily ;
- LiveSplit et OBS réels ;
- reprise d'une course après arrêt et redémarrage de la machine ;
- Bridge multi-instance HTTPS/PostgreSQL avec arrêt d'un worker en cours ;
- téléphone réel sur les deux renderers ;
- Safari iPhone hors ligne et mise à jour ;
- Firefox hors ligne sur machine réelle ;
- Windows manuel ;
- playtesteurs ignorant les puzzles ;
- connecteurs réels et sécurité humaine ;
- voix écoutées ;
- tag signé.

Chaque échec devient un ticket reproductible avec appareil, versions, monde, catégorie, seed, fichier `.wsrun` et
résultat attendu.

## 19. Hors périmètre

La 4.1.16 ne doit pas ajouter :

- une nouvelle primitive de puzzle ;
- un troisième renderer ;
- de la physique ;
- une nouvelle famille de connecteurs ;
- un backend symbolique général du solveur ;
- une solution universelle aux cas ouverts à trois personnages ;
- cloud saves, succès, Steam, GOG ou stores mobiles ;
- DRM ou protection antipiratage réelle ;
- nouveau format graphique ou audio.

Ces sujets peuvent reprendre après la fermeture des contrats existants et la validation 4.2.

## 20. Définition de « prêt pour 4.2 »

À la sortie de 4.1.16, web-scumm peut devenir candidat 4.2 lorsque cette phrase est vraie sans note de bas de page :

> Une partie Story, Remix, Fixed, Random ou Daily peut être sauvegardée, reprise, rejouée, prouvée, enregistrée en
> speedrun, vérifiée dans un processus isolé et placée dans le bon classement, avec le même verdict dans Node,
> Chromium, WebKit et Firefox ; toute limite d'authenticité ou de support est dite avant que le joueur commence.

La 4.2 ne doit alors ajouter aucune grande capacité. Elle fige ce comportement, publie les résultats des passes
humaines et transforme la ligne 4.1 expérimentale en contrat durable.

## 21. Annexe (Révision 2) : relecture contre `v4.1.15`

Confirmé dans le code : chaque défaut des §1, §4 à §12 (enveloppe schema 1 sans `variant`, `recorder.ts` qui tire
`newSeed()` pour tout sauf `fixed`, `worldVerdict` et `leaderboardKey` appelés seulement par les tests, worker qui
rejoue le jeu de base, `seedKind: fixed|random`, Daily et Runs non montés et en mémoire, reveal Mystery non signé,
`mg-record` sans écouteur, E2E absents des workflows, `pages` sur un sous-ensemble, v4.1.14 hors ascendance, docs
« schema 3 »). Deux types concurrents existent pour la politique de seed (`SpeedrunCategory.seed`,
`core/types/speedrun.ts`, et `SpeedrunSeedPolicy`, `core/remix/categories.ts`) : le lot A les fusionne. Le monde entre
déjà indirectement dans `h0` par `fingerprint.logic` (le champ `variant` de l'IR est `logic`), sans être enregistré.

Défauts que le plan ne nommait pas, ajoutés aux lots :

- lot C : `bridge/src/daily.ts` compare la date comme une chaîne (`date > today`) : `date=` ou `1999-99-99` produit un
  token signé `notBefore: null` et une nouvelle clé de stockage par chaîne ; `o.games[gameId]` sans `Object.hasOwn`
  (`game=__proto__`) ; la table du rate-limit Mystery n'est jamais purgée ; une seule clé, aucune rotation ;
- lot D : `bridge/src/runs.ts` donne deux rangs à deux temps égaux (le tri ne renvoie jamais 0) ; la déduplication est
  un `byKey` puis un `put`, sans atomicité ;
- lot E : l'`Event` de repli de `mg-record` n'a ni `bubbles` ni `detail` ; `WheelRecord` n'a pas de `failed` ;
- lot B : `canonicalJson` dans Firefox (§2) ; le commentaire de `GameDef.variant` (`core/types/game.ts`) affirme que
  l'enveloppe speedrun enregistre la variante.
- lot G : l'ascendance (§11.1) ne manquait que d'un commit, `ed8fbf6` (planchers du tag 4.1.14) ; fusionné en gardant
  les planchers de `main`, plus stricts ; `tools/release/ancestry.mjs` refuse désormais un tag dont le tag stable
  précédent n'est pas ancêtre (`ship tag` et `release.yml`).
