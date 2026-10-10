# web-scumm 4.1.19 — Field Closure

> **Révision 3 — plan vérifié contre `origin/main` après v4.1.18, puis relu par le maintainer (10–11 octobre 2026) :
> passes sur le seul candidat final, cutoff DSL, locks versionnés, provenance partagée.**  
> **Source normative :** ce fichier, dans Git, depuis la PR de cadrage `docs/4119-plan` ; toute copie hors du dépôt
> ou résumé local n'en est qu'un reflet.  
> **Base :** `v4.1.18`, commit `c00d0e87040cc5a02903aaf6dbac19ef804469d0`, candidate run
> `38060321565`.  
> **Nature :** fermeture technique, qualification et vérité de release ; aucune nouvelle mécanique planifiée par
> défaut, mais une fenêtre contrôlée accepte les extensions DSL additives réellement nécessaires.  
> **Décision du maintainer :** les passes humaines ne bloquent pas le tag 4.1.19. Leur état réel est publié ; elles
> restent la condition de promotion des surfaces et du GO vers 4.2.  
> **Branche d'assemblage :** `release/4.1.19`, après des PR courtes depuis des worktrees propres.

## 1. Verdict et ligne directrice

La 4.1.18 a réussi sa répétition générale : son candidat a produit les quatre archives, les a installées hors du
dépôt, puis la release a publié ces mêmes octets. Le Field Kit structure les essais humains. Les sept ensembles de
mutation sont bloquants. Le profil de qualification lance trois Bridges derrière HTTPS sur PostgreSQL, tue une
instance, vérifie l'isolation de deux tenants, détruit la topologie puis la restaure.

La seconde lecture montre toutefois que quelques promesses vont plus loin que leurs preuves :

- le restore n'est pas atomique sur toutes les familles de données ;
- le backup peut réunir plusieurs snapshots et n'est ni borné ni auto-descriptif ;
- le store JSONL ne sait pas être restauré correctement par cette commande ;
- l'image de qualification résout des dépendances npm au moment de sa construction ;
- le Field Kit prouve l'intégrité par rapport à un manifeste local, pas l'authenticité du candidat ;
- les noms de certains ensembles de mutation dépassent leur périmètre réel ;
- le consommateur externe ne joue de bout en bout que le webhook email ;
- la baseline 4.1.18 reprend des mesures d'un candidat antérieur au SHA publié ;
- plusieurs faiblesses et flakes connus sont documentés mais pas fermés ;
- les treize passes humaines restent ouvertes et le GO / NO-GO 4.2 reste NO-GO.

La 4.1.19 ferme ces écarts sans agrandir le moteur. Sa réussite n'est pas une longue liste de nouveautés : c'est un
backup digne d'une reprise, des artefacts reproductibles, des preuves autonomes, des affirmations exactement bornées,
un README qui montre correctement le produit actuel, et un état terrain publié sans enjolivement.

## 2. Décisions de release

### 2.1 Le tag n'attend pas les treize passes

Les lots techniques peuvent produire un **pré-candidat technique** facultatif, qui éprouve la chaîne complète : il ne
lance aucune passe, ne produit aucun rapport Field définitif et ne se présente jamais comme candidat de qualification.
Le Field Kit lie un rapport au commit, au run et aux digests des artefacts : tout commit ultérieur qui change une
archive (un README embarqué suffit) le rendrait caduc. Les passes humaines ne commencent donc que sur le **candidat
final de qualification**, construit après la PR 6, et ce même run porte la RC puis la stable. Un P0/P1 trouvé avant le
tag donne un correctif, un nouveau candidat, et les rapports touchés sont rejoués.

La 4.1.19 est taguée avec chaque rapport dans son état réel : `not-run`, `blocked`, `failed` ou `passed`.

Cette décision ne change pas la règle de support :

- une passe absente ne devient jamais verte ;
- une surface qui exige une passe reste limitée ou expérimentale ;
- un P0/P1 découvert avant le tag bloque le tag, sauf retrait explicite de la surface dans SUPPORT et GO / NO-GO ;
- un P0/P1 découvert après le tag ouvre une 4.1.20 ou retire la surface de 4.2 ; la release 4.1.19 reste immuable ;
- les passes ne « ferment » pas 4.1.19 après coup : elles ferment le dossier d'entrée en 4.2.

### 2.2 Le noyau du DSL est stable, son vocabulaire reste extensible

D28 ne doit pas être interprétée comme une interdiction dogmatique de faire évoluer le moteur. La règle de 4.1.19
devient : **les noms et les sens existants sont figés ; de nouveaux éléments optionnels peuvent être ajoutés**.

Sont interdits dans cette release :

- renommer ou retirer une condition, une commande ou un champ existant ;
- modifier le sens d'un contenu déjà valide ;
- changer silencieusement le résultat d'un replay, d'une sauvegarde ou d'une preuve existante ;
- introduire une seconde manière concurrente d'exprimer la même mécanique sans migration ;
- accepter une primitive dans le Player sans qu'elle soit comprise par les outils.

Peuvent être admis avant le cutoff DSL de la release :

- une nouvelle condition déterministe ;
- une nouvelle commande dont les effets d'état sont déclarés et reproductibles ;
- un champ optionnel de présentation ou de production ;
- une nouvelle structure de données compilée vers l'IR ;
- un helper d'auteur ou un snippet développé intégralement en DSL existant.

Une extension additive rend naturellement le jeu qui l'utilise dépendant de 4.1.19 ou plus récent ; elle ne doit pas
empêcher un jeu 4.1.18 de fonctionner à l'identique sur 4.1.19. `schemaVersion` reste 3 **par défaut** : une extension
additive qui exige réellement un nouveau schéma déclenche une décision explicite, une migration et la replanification
du candidat. `rulesVersion` ne change que si la vérification compétitive change de sens — ce qui est hors de cette
fenêtre par défaut.

Une primitive admise sort **complète et stable** dans le contrat 4.1.19, ou elle est reportée (ADR proposé pour
4.3.0). Aucune syntaxe publique ne sort « expérimentale » ou comprise à moitié par le Studio ou le solveur.

**Oracle de compatibilité.** « À l'identique » porte sur le résultat, pas sur les octets d'une preuve. Pour la démo et
la référence 4.1.18 :

- même IR logique et même fingerprint logique ;
- mêmes replays acceptés et mêmes états finaux ;
- mêmes verdicts `solved`, `softlocks`, `truncated`, mêmes objectifs et invariants ;
- aucune nouvelle sauvegarde ni migration nécessaire ;
- les sauvegardes gelées de `tests/fixtures/saves/` (3.0 → 4.1.18) se chargent toujours ;
- `tests/api-surface.json` peut grandir, jamais perdre une entrée ;
- un moteur plus ancien face à une primitive nouvelle échoue clairement, jamais ne l'ignore en silence.

L'ordre d'exploration, le témoin choisi, les métriques et la sérialisation des rapports peuvent changer.

### 2.3 Guichet d'admission des extensions DSL

Une proposition entre par une PR dédiée `dsl/4119-<feature>` et un court ADR. **L'admission est close avant la
création de la branche de la PR 3** ; toute PR DSL acceptée est fusionnée avant que la PR 3 mesure sa première
baseline. Après ce cutoff, seules ses corrections sont admises ; aucune primitive tardive n'entre dans la PR de
release. Le verdict est écrit dans le LOG :

```text
DSL admission:
- accepted: <liste | none>
- deferred: <id → raison, cible>
- rejected: <id → raison>
- reserved ADR 0022: used | unused
- window: closed
```

Le dossier d'admission contient :

1. un chapitre, une scène ou une fixture qui a réellement besoin de la fonctionnalité ;
2. les compositions existantes essayées et la raison précise pour laquelle elles sont insuffisantes ou
   déraisonnablement fragiles ;
3. la forme TypeScript et un exemple de contenu ;
4. la sémantique déterministe, les effets d'état et les erreurs de validation ;
5. les conséquences sur ids, IR, fingerprint, sauvegardes, replay, Remix et speedrun ;
6. le comportement du solveur, y compris softlocks, aléatoire et réduction d'état ;
7. la stratégie Studio, MCP, i18n, documentation et migration ;
8. les performances et budgets attendus ;
9. le plan de retrait ou de dépréciation si l'expérimentation échoue avant 4.2.

La propagation minimale est bloquante : types et schéma, `compileGame`, IR et fingerprint, runtime, validateur,
solveur, replay/session, Studio, MCP, docs générées, template et tests de propriété. Une surface réellement non
concernée est marquée `N/A` avec justification ; elle n'est pas simplement oubliée.

Trois classes permettent de garder la release proportionnée :

- **A — auteur ou présentation** : compile vers le contrat existant ou ne change pas l'état ; faible risque ;
- **B — logique déterministe** : nouvelle condition/commande avec effets prouvables ; ADR et matrice complète ;
- **C — rupture ou non-déterminisme** : renommage, nouvelle sémantique, JavaScript arbitraire, payload réseau brut,
  dépendance à l'heure réelle ou état non sérialisable ; refusée en 4.1.19 sauf décision explicite du maintainer qui
  replanifie la release.

Exemples de candidats raisonnables à étudier, sans admission automatique : métadonnées de performance par `lineId`,
snippets d'auteur compilés, ou primitive déterministe révélée par un vrai chapitre. Les payloads externes arbitraires,
une condition `{ variant }` redondante ou une deuxième timeline restent de mauvais candidats sans preuve nouvelle.

### 2.4 Documents de décision

- **D33** : périmètre de 4.1.19, tag sans attendre les passes, sémantique existante du DSL stable mais fenêtre
  additive avant cutoff, surfaces non promues sans preuve. D33 amende l'interprétation absolue de D28 sans autoriser
  de rupture.
- **ADR 0021** (réservé) : backup schema 3, snapshot, limites et restore tout-ou-rien.
- **Un ADR par extension DSL admise** : forme, nécessité, propagation et compatibilité. **ADR 0022** est réservé à la
  première ; les suivants sont numérotés à la fusion. Une réservation inutilisée reste vacante : aucun ADR vide. D34 n'est utilisé que si une
  nouvelle décision publique distincte le nécessite ; renommer un job interne ne suffit pas.
- **LOG #161** : adoption du plan et passage de la main ; les entrées suivantes restent append-only.

## 3. Relecture séquentielle du plan initial

### 3.1 Restore : diagnostic confirmé, abstraction à corriger

Le diagnostic est exact : le JSON est casté sans schéma, les tenants sont importés chacun dans leur transaction, puis
`runs` et `daily_kv` sont traités ailleurs. Une erreur tardive peut laisser un restore partiel.

Amendement : ne pas ajouter `importAll()` au contrat général `RealityStore`. JSONL ne peut pas l'implémenter
correctement et le runtime n'en a pas besoin. Introduire une capacité interne d'exploitation, par exemple
`SqlBackupStore` ou une méthode protégée de `SqlRealityStore`, qui reçoit le snapshot validé et utilise un unique
`SqlQuery` transactionnel.

La relecture après commit reste un audit, pas une condition tardive susceptible d'annoncer l'échec après mutation.
Les comptes, références et empreintes logiques qui déterminent le succès sont vérifiés **avant le commit dans la
transaction**. Une relecture après commit peut détecter un défaut du backend et lever une alerte critique, mais elle ne
remplace pas l'atomicité.

### 3.2 Backup : exports concurrents, pas séquentiels

Les `exportTenant` sont lancés par `Promise.all`. Sur PostgreSQL, chacun prend une connexion et un snapshot distinct ;
`runs` et `daily_kv` arrivent encore dans une transaction ultérieure. Le défaut n'est donc pas seulement « plusieurs
étapes séquentielles » : c'est un ensemble concurrent de snapshots indépendants.

L'export schema 3 doit exécuter toutes les lectures par le même objet transactionnel. Sur PostgreSQL :
`REPEATABLE READ READ ONLY`. Sur SQLite en WAL : une transaction de lecture dont le snapshot est établi avant la
première requête utile.

### 3.3 JSONL : refus explicite

Le restore JSONL actuel ne peut pas tenir son contrat : `tenants()` expose `default`, `--force` conduit à un delete
non durable puis à une exception, et l'import n'est pas transactionnel.

La 4.1.19 refuse donc `restore` vers JSONL **avant toute mutation**, avec un message indiquant de migrer vers SQLite.
Les anciens backups schema 1 restent lisibles lorsqu'ils sont restaurés vers SQLite ou PostgreSQL. Ce changement est
documenté dans UPGRADING et REALITY-OPS.

### 3.4 Image : distinguer trois empreintes

« Digest de l'image » est ambigu. Le plan distingue désormais :

1. le digest du manifeste OCI ;
2. l'identifiant/config digest de l'image chargée ;
3. le SHA-256 du fichier OCI ou `docker save` transporté comme artefact.

Un tar Docker n'a pas automatiquement un `RepoDigest`. Le candidat doit produire un layout OCI déterministe ou, à
défaut, publier les trois valeurs pertinentes et vérifier après chargement que l'image correspond à son manifeste.
La release ne reconstruit pas l'image.

### 3.5 SBOM : conserver le format réellement promis

La 4.1.18 publie des SBOM **CycloneDX** (`*.cdx.json`) et le CHANGELOG promet ce format depuis 4.0. La 4.1.19 produit
donc cinq SBOM CycloneDX cohérents — moteur, créateur, Bridge, connecteurs, image — sans introduire un second format
sans consommateur démontré.

### 3.6 Field Kit : intégrité, authenticité et mode hors ligne

Le bundle n'inclut pas le manifeste candidat, le chemin `evidence/evidence/` est produit systématiquement, aucun
budget en octets n'existe et FIELD présente trop fortement le scanner de secrets.

Le mode en ligne doit vérifier le run et son `headSha`. Le mode hors ligne ne peut pas prétendre interroger GitHub :
il vérifie une attestation et un manifeste déjà téléchargés, dont le sujet est l'artefact candidat. Le workflow doit
donc produire cette attestation avec les permissions minimales nécessaires. Le scanner reste une barrière heuristique,
jamais une garantie d'absence de secret dans une image ou un binaire.

### 3.7 Mutation : préférer la compatibilité au renommage brutal

Le set `connectors` ne couvre que six noyaux purs et `reality-store` ne mute pas directement l'adaptateur PostgreSQL.
La documentation doit le dire.

Amendement : le nom canonique peut devenir `connectors-pure`, mais la CLI accepte `connectors` comme alias déprécié
pendant la fin de la ligne 4.1.x. Les workflows utilisent le nom canonique ; les anciens scripts ne cassent pas. Les
nouveaux sets `connectors-edge` et `reality-store-postgres` commencent mesurés, puis deviennent bloquants seulement
après lecture de tous leurs survivants.

### 3.8 Consommateur externe : séparer packaging et protocole

Le consommateur externe prouve surtout les frontières de package et la portabilité. Lui faire démarrer des serveurs
SSH, Telnet, IMAP et Badge complets sur trois OS le rendrait lent et fragile.

La 4.1.19 sépare :

- `external-consumer` : installation et usage public sur Ubuntu, macOS et Windows ;
- `connector-archive-e2e` : scénarios protocolaires complets depuis les archives, sur Linux avec services épinglés ;
- passes humaines : vrais fournisseurs et exposition contrôlée.

### 3.9 Baseline : supprimer la circularité du numéro de run

Un fichier committé ne peut pas contenir le numéro du candidat final qui teste ce même commit : inscrire ce numéro
créerait un nouveau commit et invaliderait le candidat.

Le candidat final produit donc `baseline-4.1.19.json` et `baseline-4.1.19.md` comme artefacts exacts ; GitHub fournit
`GITHUB_RUN_ID` pendant le run. La release attache ces fichiers sans les reconstruire. Le fichier committé
`docs/dev/baselines/4.1.19.md` décrit les seuils, le protocole et le nom stable des artefacts, mais ne prétend pas
connaître à l'avance le run final. Les notes de release lient les artefacts exacts.

### 3.10 README : le rééquilibrer, pas l'allonger

Le README actuel est riche et honnête, mais il raconte successivement le joueur, l'auteur, l'IA, la preuve, Reality,
les nombres et quinze releases. Le produit principal — fabriquer un point-and-click — peut se perdre derrière la
machine de validation.

La 4.1.19 refond les README anglais et français autour de trois promesses :

1. créer un jeu d'aventure comme des données ;
2. le voir et l'éditer dans le Studio ;
3. le vérifier et le livrer sur le Web/PWA.

Reality, Remix, speedrun et l'infrastructure restent visibles, mais après le parcours principal, avec leur niveau de
maturité exact.

## 4. Découpage en PR

Chaque PR part d'un worktree neuf créé depuis `origin/main`, porte le label `full-ci` lorsque son périmètre l'exige,
ajoute ses fragments `changes/<slug>.md` et `.log.md`, puis reçoit une seconde lecture automatisée indépendante avant
fusion. Une seule grosse suite tourne à la fois sur le Mac ; Docker, mutation lourde et PostgreSQL tournent sur les
runners.

| # | Branche | Contenu | Dépend de |
|---:|---|---|---|
| C | `docs/4119-plan` | ce plan, D33, LOG #161, réservations ADR | — |
| 0 | `dsl/4119-<feature>` | extension DSL additive admise, s'il en existe une | dossier d'admission accepté |
| 1 | `fix/4119-backup-restore` | snapshot schema 3, restore SQL atomique, refus JSONL | — |
| 2 | `ops/4119-artifacts-field` | locks, image OCI, SBOM, Caddy, Field Kit | — |
| 4 | `fix/4119-leftovers` | défauts mineurs, RTA et compatibilité upgrade | — |
| 3 | `test/4119-coverage-truth` | mutation, archive e2e, Vite, flakes | 0 éventuelle, 1, 2 et 4 |
| 5 | `ops/4119-qualify-full` | topologie complète PostgreSQL | 1, 2 ; après 4 conseillé |
| — | pré-candidat technique | chaîne complète, facultatif, **sans Field** | 1 à 5 |
| 6 | `release/4.1.19` | README, captures, docs, seuils et préparation du tag | 1 à 5 |
| — | candidat final de qualification | `field:init` sur #75–#87, baseline exacte, rc puis stable | PR 6 |

La PR C met ce plan dans Git avant tout worktree : les PR suivantes partent du `origin/main` qui la contient. Les PR 1,
2 et 4 avancent en parallèle. Une éventuelle PR DSL suit son propre dossier d'admission et doit fusionner
avant la PR 3. La PR 3 vient après elles afin de mesurer et nommer le code final, plutôt que de renommer les ensembles
avant les derniers correctifs. La PR 5 peut commencer après 1 et 2 mais utilise, si possible, les corrections de 4 et
de toute extension DSL qui affecte ses scénarios.

### 4.1 PR 0 — Extension DSL optionnelle

Cette PR n'existe que si un besoin passe le guichet du §2.3. Elle ne devient pas un prétexte pour remplir la release.

Ordre interne obligatoire :

1. fixture rouge et ADR ;
2. types, schéma et compilation ;
3. IR, fingerprint et ids ;
4. runtime et sauvegarde/replay ;
5. validateur, solveur et propriétés ;
6. Studio, MCP, i18n et documentation générée ;
7. template ou exemple minimal ;
8. matrice de propagation et seconde lecture.

Le changement est rejeté de 4.1.19 si une seule surface nécessaire reste simulée, si le solveur doit supposer son
effet, si une sauvegarde existante change de sens, ou si son coût force à enlever une gate de Field Closure. Une
fonctionnalité valable mais trop large est conservée comme ADR proposé pour 4.3.0.

## 5. PR 1 — Backup cohérent et restore tout-ou-rien

### 5.1 Tests rouges initiaux

- tenant valide suivi d'un tenant invalide ;
- colonne inconnue dans la dernière ligne de `runs` ;
- champ autorisé mais de type invalide ;
- conflit tardif avec et sans `--force` ;
- fichier tronqué, doublonné, trop grand ou mal typé ;
- Daily déjà présent : refus sans `--force`, remplacement déterministe avec ;
- égalité logique complète du store avant et après tout restore échoué ;
- tentative JSONL refusée avant mutation.

### 5.2 Schéma et lecture bornée

- Ajouter `bridge/src/backup-schema.ts`, Zod strict, pour les schémas 1, 2 et 3.
- Lister les colonnes autorisées par table et imposer leur ordre canonique.
- Vérifier ids, types, tailles, cardinalités, doublons et références croisées.
- Vérifier que chaque `runs.tenant_id` appartient aux tenants exportés.
- Ouvrir le fichier, faire `fstat`, refuser au-delà du budget, puis lire au plus `budget + 1` octets. Un simple
  `readFileSync` suivi d'un contrôle serait trop tard pour protéger la mémoire.
- Refuser liens, fichiers non réguliers et changements de taille pendant la lecture.

### 5.3 Restore SQL atomique

- Introduire une capacité interne SQL de restauration globale ; ne pas élargir `RealityStore` pour JSONL.
- Ouvrir une transaction unique, avec verrouillage opérateur approprié.
- Sans `--force`, vérifier tous les conflits avant le premier delete.
- Avec `--force`, supprimer puis insérer dans la même transaction.
- Ne jamais interpoler une colonne lue dans le fichier sans passage par la liste blanche.
- Recalculer comptes, relations et empreinte logique dans la transaction avant commit.
- Après commit, effectuer une relecture de santé distincte et produire un rapport ; toute divergence devient P0.

### 5.4 Backup schema 3

Enveloppe minimale :

- `format`, `schema: 3` ;
- version du Bridge et version du schéma SQL ;
- backend source ;
- `startedAt`, `endedAt` ;
- comptes par famille ;
- payload canonique ;
- algorithme et empreinte du payload, l'empreinte ne se couvrant pas elle-même.

Toutes les données SQL sont lues dans une seule transaction et par le même `SqlQuery`. L'écriture cible utilise un
fichier temporaire privé, `fsync` lorsque la plateforme le permet, puis un rename atomique. Une interruption ne laisse
pas un fichier final tronqué.

Le format reste un backup logique portable et borné. REALITY-OPS indique quand utiliser `pg_dump` ou les snapshots du
fournisseur pour les gros déploiements.

### 5.5 Charge et mutation

- écrivain continu pendant plusieurs backups SQLite et PostgreSQL ;
- restauration puis vérification des invariants de séquence, acks, runs et Daily ;
- test de taille limite et de refus au-delà ;
- test qui compte les transactions et tue l'équivalent `>` → `>=` de migrations ;
- suppression de cet équivalent dans `mutants.json` une fois tué ;
- mutation `reality-store` par fichier touché sur le runner.

### 5.6 Critère de sortie

Un restore non nul laisse le store logiquement identique à son état initial. Un backup réussi représente un snapshot
unique, borné et vérifiable ; sinon aucun fichier final valide n'est produit.

## 6. PR 2 — Artefacts reproductibles et Field Kit autonome

### 6.1 Verrouillage des packages

- Versionner dans le dépôt des locks **dédiés** au Bridge et aux connecteurs, générés une fois depuis le lock racine,
  relus, puis vérifiés par la CI. Une extraction dynamique du sous-graphe racine (peers optionnels, dépendances par
  plateforme, intégrités, variantes de `ssh2`) n'est pas retenue.
- `pack.mjs` copie et valide ces locks dans les archives (`npm-shrinkwrap.json`) ; il ne résout rien sur le réseau et
  ne décide aucune version pendant le candidat.
- Un test refuse tout écart entre un lock et son `package.json` ; `npm ci` refuse toute divergence.
- Épingler exactement `pg` et OpenTelemetry pour l'image distribuée.
- Passer le Dockerfile à `npm ci --omit=dev`.
- Reproductibilité des archives : identité binaire sur le toolchain fixé du candidat ; à défaut, identité d'un
  manifeste canonique de contenu (mêmes fichiers, modes, tailles et SHA-256 internes) sur toutes les plateformes. Node
  et npm sont enregistrés dans le rapport. Ne pas confondre reproductibilité logique et archive identique multi-OS.
- Tester que les archives n'ont ni dépendance `file:`, ni chemin de checkout, ni lock incohérent avec leur
  `package.json`.

### 6.2 Image candidate

- Construire une fois dans un job dédié.
- Exporter un layout OCI ou un tar vérifiable, accompagné de : digest du manifeste OCI, config digest et SHA-256 de
  l'archive transportée.
- Charger cet artefact dans `deployment-smoke` et `qualify`, puis vérifier les digests après chargement.
- L'ajouter au manifeste candidat et le publier sans reconstruction.
- Épingler également l'image Node utilisée ailleurs dans candidate.yml.

### 6.3 SBOM et licences

Produire dans le candidat cinq SBOM CycloneDX (`*.cdx.json`) :

1. `web-scumm` ;
2. `create-web-scumm` ;
3. `web-scumm-bridge` ;
4. `web-scumm-connectors` ;
5. image Bridge.

Ils sont calculés depuis les packages et locks réellement contenus dans les artefacts. La release ne lance plus un
`npm install` séparé pour fabriquer une autre vision des dépendances. Les contrôles de licences utilisent la même
résolution.

### 6.4 Caddy et topologie

- Utiliser une image épinglée par digest.
- Exécuter Caddy sans root sur un port interne non privilégié lorsque possible.
- Passer le root filesystem en lecture seule.
- Monter seulement les dossiers réellement inscriptibles (`/data`, `/config` ou équivalents) en volume/tmpfs borné.
- Ne conserver aucune capacité Linux si le port interne ne l'exige pas ; sinon justifier uniquement
  `NET_BIND_SERVICE`.
- Tester démarrage, rotation locale des certificats et redémarrage avec ces contraintes.

### 6.5 Field Kit v2

- Inclure `candidate-manifest.json` et l'attestation du candidat dans le bundle.
- Corriger définitivement `evidence/evidence/...`.
- Ajouter `field:verify-bundle` avec extraction sûre : chemins absolus, `..`, liens symboliques et durs, devices,
  doublons et archives imbriquées refusés.
- Vérifier schéma, empreintes, manifeste, sujet de l'attestation et cohérence release/commit/run.
- En ligne, vérifier via GitHub la conclusion et le `headSha` du run.
- Hors ligne, vérifier l'attestation déjà embarquée sans prétendre connaître un état GitHub ultérieur.
- Ajouter budgets par fichier, total, nombre d'entrées et durée ; lire en flux ou de façon bornée.
- Dire dans FIELD anglais et français que le scanner de secrets est heuristique.
- Ajouter une version de bundle et conserver la lecture du schema 1 lorsqu'elle est sûre.
- Extraire `tools/release/provenance.ts`, partagé par `ship` et `field:verify-bundle`, en quatre fonctions
  composables : lire et vérifier le manifeste local ; vérifier les digests ; vérifier une attestation téléchargée ;
  interroger le run GitHub. Seule la dernière dépend de GitHub. `ship` compose les quatre ;
  `field:verify-bundle --offline` utilise les trois premières.

### 6.6 Critère de sortie

Une personne possédant seulement un bundle et les racines de confiance documentées peut vérifier de quel candidat il
provient. L'image et chaque package ont une empreinte, un lock, un SBOM et une provenance cohérents.

## 7. PR 4 — Restes des relectures et RTA

Cette PR précède la vérité de couverture afin que les nouveaux ensembles mesurent le code corrigé.

### 7.1 SDK Bridge et corps nul

- Reproduire le cas où une réponse reprise possède un corps nul.
- Distinguer réponse vide, réponse malformée, erreur temporaire et Bridge réellement inaccessible.
- Vérifier retry, backoff, déduplication et message opérateur.

### 7.2 Terminal UTF-8

- Reproduire l'octet de continuation isolé sur une ligne vide.
- Tester aussi un caractère multi-octets séparé entre deux chunks réseau.
- Le backspace supprime un point de code saisi, jamais une colonne du prompt.
- Une séquence UTF-8 invalide est remplacée ou refusée selon le contrat du décodeur, sans corrompre le buffer.

### 7.3 RTA après reprise

- Définir trois horloges dans les tests : temps scellé, temps de session active, affichage RTA.
- Avant le vrai départ d'une run reprise, l'affichage reste à zéro.
- Après départ, il continue selon la règle de catégorie sans modifier le temps scellé.
- `rulesVersion`, enveloppe `.wsrun` et verdicts existants restent identiques.
- La passe `livesplit-obs` reste ouverte jusqu'au vrai test.

### 7.4 Upgrade externe

- Tester la mise à niveau depuis 4.1.16 et 4.1.17 vers le candidat.
- Couvrir un tag stable et un pré-release sans inventer `vv…` ni inclure le suffixe RC dans le nom du tarball.
- Utiliser les archives publiées avec leurs empreintes connues.

### 7.5 Critère de sortie

Chaque défaut possède un test rouge devenu vert. Aucune correction ne change un format, un temps scellé ou une
sémantique DSL.

## 8. PR 3 — Vérité de la couverture, maintenance et flakes

### 8.1 Mutation

- Introduire `connectors-pure` comme nom canonique et garder `connectors` comme alias compatible jusqu'à 4.2.
- Corriger SETS, TESTS, GATED, workflows, rapports et documentation.
- Créer mesurés mais non bloquants :
  - `connectors-edge` : config/run, webhook/IMAP, badge verify, terminal guard/shell, orchestration SSH/Telnet ;
  - `reality-store-postgres` : adaptation et erreurs spécifiques PostgreSQL.
- Lire chaque survivant. Un set devient bloquant seulement avec zéro survivant inexpliqué ou une justification
  précise dans `mutants.json`.
- Réécrire `docs/dev/MUTANTS.md` et borner les formulations de CHANGELOG, TOOLS et ROADMAP.

Le protocole de lecture peut être parallélisé, mais la vérité du gate ne dépend pas d'un agent : elle dépend des tests,
du rapport et de la seconde lecture enregistrée.

### 8.2 Scénarios depuis les archives

Conserver `external-consumer` portable pour l'installation, les exports et les commandes publiques. Ajouter sur Linux
un job `connector-archive-e2e` qui installe exclusivement l'archive candidate :

- email webhook : pairing, accepté, doublon, signature invalide ;
- email IMAP : serveur déterministe épinglé, récupération, doublon et message malformé ;
- Telnet : pairing, commande acceptée/refusée, limite, déconnexion, UTF-8 ;
- SSH : même parcours, authentification, chunks UTF-8 et backspace ;
- Open Badge : valide, invalide, indéterminé, redirect, destination privée et changement DNS refusés.

Les services conteneurisés sont épinglés par digest. Si un petit serveur de test Node suffit et réduit la chaîne de
confiance, le préférer. Aucun de ces scénarios ne remplace le pass auprès d'un vrai fournisseur.

### 8.3 Vite 8

Critère d'acceptation avant de choisir le refactor : la configuration se charge avec le loader natif sans
`VITE_CONFIG_NATIVE_IGNORE_WARNING`, sans importer tout le Studio dans son graphe et sans modifier le bundle joueur.
Ajouter un test de caractérisation avant de déplacer `plugin → assets → core/types`. Ne retirer les parameter
properties TypeScript que si le problème est reproduit avec la version ciblée.

### 8.4 Scripts

Découper uniquement `external-consumer` et `ops-qualify`, déjà touchés : processus portables, artefacts,
environnements, scénarios, assertions et rapports. Chaque étape porte un id et une durée ; une erreur nomme la première
étape fautive et la commande de reproduction.

### 8.5 Flakes

- ssh2 « Malformed OpenSSH private key » : conserver la clé et les logs fautifs, puis valider immédiatement la paire
  générée avant son utilisation ;
- WebKit « 1 browser error » vide : capturer type, stack, page, console et `pageerror` avant toute correction ;
- Biscuit `test013_block_rules` : isoler charge et limite CPU ; ne relever le timeout qu'après mesure démontrant que
  le test valide encore la propriété voulue.

Un flake non reproduit reçoit de l'observabilité, pas un budget arbitrairement augmenté.

## 9. PR 5 — Profil ops/qualify complet

Dans la topologie PostgreSQL utilisant l'image candidate de PR 2, ajouter :

- file de runs et workers confinés ;
- kill d'un worker pendant une vérification ;
- Daily et Mystery ;
- quotas partagés entre instances ;
- modération avec token file ;
- leaderboard après volume significatif ;
- backup schema 3 contenant tenants, runs et Daily ;
- destruction du réseau, des conteneurs et du volume, puis restore ;
- migration d'un store 4.1.17 créé par l'archive publiée correspondante.

La fixture 4.1.17 est créée pendant le job depuis l'archive et son digest connu ; ne pas committer un dump opaque. Le
workflow `qualify` exécute le scénario complet. `deployment-smoke` rejoue un sous-ensemble court dans le candidat. Les
jobs spécialisés de charge, migration, worker et store restent en place : le profil les relie, il ne les remplace pas.

Le profil automatique ne remplace pas les 24–48 heures derrière un vrai domaine.

Critère : aucun effet perdu, doublé ou croisé ; séquences contiguës ; queue, quota, modération, backup et migration
observables dans un rapport lié à l'image exacte.

## 10. Pré-candidat technique et passes

Après les PR 1 à 5, un pré-candidat technique **facultatif** peut éprouver la chaîne : lancer le candidat sur le SHA
exact, lire la conclusion **et** la gate, vérifier archives, image, SBOM et attestations. Il n'est commenté sur aucune
issue et ne produit aucun rapport Field.

Les passes commencent sur le **candidat final de qualification** (§13), après la PR 6 :

1. lire la conclusion du run **et** la gate ;
2. vérifier les quatre archives, l'image, les cinq SBOM et leurs attestations ;
3. commenter sur #75–#87 le run, les digests et la commande `field:init` ;
4. ne fermer aucune issue à la place du maintainer.

Un défaut terrain donne `fix/4119-field-<id>` : rapport expurgé, reproduction, test rouge, correctif, nouveau candidat,
puis répétition des passes dont la surface ou l'artefact a changé.

La release n'attend pas que toutes les issues soient fermées. Elle attend que tout P0/P1 **déjà découvert** soit
corrigé ou que sa surface soit retirée du périmètre annoncé.

## 11. PR 6 — README, documentation et préparation de release

### 11.1 Refonte du README

Mettre à jour `README.md` et `README.fr.md` ensemble. L'objectif est une page plus courte dans sa première moitié,
orientée vers la création d'un jeu, sans cacher les fonctions avancées ni les limites.

Ordre recommandé :

1. logo, phrase de valeur et trois liens : jouer, Studio, démarrer ;
2. capture actuelle du jeu ;
3. démarrage minimal depuis l'archive 4.1.19 ;
4. « Build a game » : contenu déclaratif, Studio, art/audio, localisation ;
5. « Prove and ship it » : validation, solveur, replay, PWA et compatibilité ;
6. fonctions avancées : plusieurs personnages, Remix, speedrun, Reality ;
7. tableau de maturité : stable, limité, expérimental, avec lien SUPPORT ;
8. architecture courte et carte du dépôt ;
9. collaboration humaine/IA et contribution ;
10. documentation, licences et état de la release.

Principes éditoriaux :

- le point-and-click reste le sujet principal ; Reality n'occupe pas le premier écran ;
- ne pas répéter l'historique de quinze releases dans le README : ROADMAP et CHANGELOG le font ;
- ne pas afficher de compte de tests écrit à la main ; utiliser un bloc généré ou une affirmation stable ;
- distinguer « un chemin gagnant existe » de « tous les états accessibles ont un chemin vers une fin » ;
- distinguer tests axe et conformité WCAG humaine ;
- ne pas présenter Canvas, Postgres distribué ou connecteurs comme stables avant leurs passes ;
- garder « content is data » tout en rappelant que les extensions TypeScript sont du code de confiance ;
- conserver un quick start copiable et testé : le test lit la commande du README, remplace l'URL `v4.1.19` (qui
  n'existe pas encore) par l'archive candidate locale, exécute exactement le reste ; après publication, l'URL réelle
  doit répondre avec le digest attendu ;
- maintenir la parité anglais/français par `docs:truth`.

### 11.2 Captures actuelles

Régénérer avec `npm run docs:screenshots`, depuis le vrai player et le vrai Studio :

- héros : scène de jeu actuelle, interface complète et texte lisible ;
- Studio : vue qui combine contenu, aperçu et vérification ;
- preuve : graphe ou rapport de softlocks ;
- fonction avancée : Remix ou Time Attack, pas les deux si la page devient lourde.

Les anciennes images ne sont pas supprimées ; si elles sont remplacées, elles sont conservées avec leur suffixe de
version conformément à AGENTS.md. Les nouvelles images vont sous `docs/img/readme/4119-*`, WebP optimisé, dimensions
et budget contrôlés, texte alternatif en anglais et en français. Aucune clé, URL privée, pseudonyme réel ni contenu de
rapport terrain n'apparaît.

Vérifications visuelles : desktop clair/sombre si pertinent, largeur mobile du README GitHub, texte dans les images
encore lisible, aucune capture d'un mode `?dev` non livrable.

### 11.3 Test de vérité README

Étendre le test existant afin de vérifier :

- version et URL du tarball ;
- commandes réellement présentes dans le package ;
- images existantes et sous budget ;
- mêmes grandes sections en français et anglais ;
- niveaux de support cohérents avec `docs/en/SUPPORT.md`, `docs/fr/SUPPORT.md` et GO / NO-GO ;
- aucun ancien nombre de tests ou état de release oublié ;
- aucun lien local ou ancre cassé.

### 11.4 Autres documents

- D33 et ADR 0021 ; D34 seulement si un second contrat public l'exige ;
- LOG #161 et suivants ;
- UPGRADING : backup schema 3, lecture 1/2, refus JSONL ;
- REALITY-OPS, FIELD, MUTANTS, TOOLS, ROADMAP ;
- SUPPORT anglais et français ;
- `docs/dev/passes/4.1.19.md` avec l'état réel au moment de la PR ;
- GO / NO-GO 4.2 surface par surface ;
- fragments assemblés sous `## Unreleased`.

## 12. Baseline sans circularité

### 12.1 Dans Git

`docs/dev/baselines/4.1.19.md` contient :

- seuils décidés avant mesure ;
- commandes et protocoles ;
- colonne historique 4.1.18 correctement attribuée ;
- nom attendu des artefacts exacts de release ;
- `non mesuré sur ce candidat` pour toute mesure absente.

Il ne contient pas un numéro de run final inconnu au moment du commit.

### 12.2 Dans le candidat final

Le workflow produit `baseline-4.1.19.json` et `.md` avec : SHA, `GITHUB_RUN_ID`, OS, Node, digests, commandes, date,
cache chaud/froid et mesures. Ils entrent dans `candidate-manifest.json`, sont attestés puis publiés comme release
assets.

Mesures minimales : tests/skips, preuves démo et référence, installations externes, scénarios connecteurs, charges
SQLite/PostgreSQL, leaderboard, qualification, mutation et liste de sources, poids joueur, statuts Field, durée et
chemin critique du candidat.

## 13. Candidat final et publication

Le candidat final, lancé après fusion de PR 6, doit :

1. viser le SHA exact proposé aux tags ;
2. produire une fois les quatre archives et l'image OCI ;
3. produire manifestes, sommes, provenance, licences et cinq SBOM ;
4. installer les archives hors dépôt sur Ubuntu Node 22/24, macOS et Windows ;
5. jouer upgrades, sauvegardes, runs et walkthroughs ;
6. exécuter `connector-archive-e2e` ;
7. éprouver backup/restore sous erreur et trafic ;
8. qualifier SQLite et PostgreSQL ;
9. exécuter chaque set bloquant dans son propre job ;
10. si une extension DSL a été admise, vérifier sa matrice de propagation, ses fixtures, ses propriétés et la
    compatibilité des jeux antérieurs ;
11. produire les baselines exactes et l'état Field disponible ;
12. échouer sur un job absent, skipped, rouge ou issu d'un autre SHA.

Publication :

1. lire la gate et la conclusion, puis commenter le candidat sur #75–#87 (`field:init`) ;
2. `ship tag 4.1.19-rc.1 <sha> --candidate=<run> --now` ;
3. `ship verify 4.1.19-rc.1` ;
4. `ship tag 4.1.19 <même sha> --candidate=<même run> --now` ;
5. `ship verify 4.1.19` ;
6. les passes se poursuivent sur ce candidat (commenté sur #75–#87 dès sa gate verte, §10) et décident la 4.2 ;
7. considérer le nightly suivant comme audit et le **classer** avant toute décision : défaut du produit, flake connu,
   panne GitHub, registre indisponible, quota, changement d'un fournisseur ou mesure régressée. Seul un défaut du
   produit ou une régression confirmée ouvre une 4.1.20 ; une panne extérieure est documentée et relancée. La release
   n'est jamais altérée.

La release publie les artefacts du candidat ; elle ne reconstruit ni package, ni image, ni SBOM, ni baseline.

## 14. Critères de sortie du tag 4.1.19

Les passes humaines ne bloquent pas le tag. En revanche, le tag est bloqué tant que :

- [ ] un restore échoué peut laisser le store partiellement modifié ;
- [ ] un backup réussi peut mélanger plusieurs snapshots sans le dire ;
- [ ] JSONL commence une restauration qu'il ne peut rendre atomique ;
- [ ] l'image qualifiée résout des dépendances non verrouillées ;
- [ ] l'image, les quatre archives ou leurs SBOM ne sont pas liés au candidat ;
- [ ] un bundle Field exact ne peut pas être vérifié indépendamment ;
- [ ] les preuves Field ne sont pas bornées en taille ;
- [ ] un nom de couverture affirme plus que les fichiers et scénarios réellement jugés ;
- [ ] la baseline exacte n'est pas un artefact du candidat final ;
- [ ] un P0/P1 connu reste ouvert sans retrait explicite de la surface ;
- [ ] README ou SUPPORT promeuvent une surface sans preuve ;
- [ ] une sémantique DSL existante, `rulesVersion` ou un format stable a changé sans migration et décision explicites ;
- [ ] une extension DSL additive a contourné le guichet, manque une surface de propagation ou arrive après le cutoff ;
- [ ] le run, son SHA et les artefacts du tag ne correspondent pas exactement.

## 15. GO / NO-GO vers 4.2

La publication de 4.1.19 ne rend pas automatiquement le GO vert.

### GO 4.2

- chaque surface annoncée stable possède ses preuves automatiques et sa passe requise ;
- les autres sont explicitement limitées, expérimentales ou hors périmètre ;
- aucun P0/P1 terrain ne touche le périmètre stable ;
- le maintainer approuve le tableau surface par surface ;
- publication npm et tag signé sont répétés à partir des artefacts du candidat sans changer son code.

### NO-GO 4.2

- une passe requise est `not-run`, `blocked` ou `failed` pour une surface que l'on veut dire stable ;
- un défaut révèle perte, doublon, mauvaise reprise, fuite d'isolation ou contournement ;
- une correction n'a pas été rejouée sur un nouveau candidat ;
- le périmètre stable reste ambigu ;
- une extension DSL nécessaire reste incomplète, non prouvée ou incompatible avec le contrat stable.

## 16. Vérification par PR

Pour chaque PR :

- les tests rouges annoncés deviennent verts ;
- `npm run quality`, `npm run quality:baseline` et, si les docs changent, `npm run docs:truth` passent ;
- `pr-gate` est vert et liste réellement les jobs attendus ;
- la mutation des fichiers touchés ne laisse aucun survivant inexpliqué ;
- le fragment de changelog et de LOG est présent ;
- la seconde lecture est enregistrée avant fusion.

Vérifications spécifiques :

- PR 0 éventuelle : fixture de nécessité, ADR, propagation complète, propriétés et compatibilité 4.1.18 ;
- PR 1 : égalité avant/après tous les échecs, round-trip schema 3 SQLite/PostgreSQL, écrivain concurrent ;
- PR 2 : image chargée conforme à ses trois empreintes, cinq SBOM, bundle altéré refusé, mode hors ligne prouvé ;
- PR 4 : verdicts, formats et temps scellés inchangés ;
- PR 3 : alias ancien testé, nouveaux sets mesurés, logs complets des flakes ;
- PR 5 : workflow `qualify` complet vert sur runner Docker ;
- PR C : copie committée identique (SHA-256) au document relu, `docs:truth` vert ;
- PR 6 : README bilingue, captures inspectées, quick start joué depuis l'archive candidate ;
- release : candidate gate et conclusion vertes, `ship verify` sur RC et stable, baseline attachée du même run.

## 17. Hors périmètre

- rupture, renommage ou changement de sens d'une primitive DSL existante ;
- primitive DSL proposée après le cutoff ou partiellement propagée ;
- nouveau format de jeu qui ne serait pas strictement nécessaire à une extension additive admise ;
- nouveau renderer, connecteur ou backend ;
- changement de `rulesVersion` ;
- identité joueur générale ;
- cloud propriétaire ;
- promesse Steam, stores mobiles, cloud saves ou DRM ;
- réécriture globale du Bridge, du Studio, du solveur ou des outils ;
- faire passer une absence de test pour une réussite ;
- publication npm stable et tag signé, réservés à la décision 4.2.

## 18. Résumé exécutable pour l'agent

Fusionner d'abord la PR C, qui met ce plan dans Git. Ouvrir ensuite le guichet DSL : si une fonctionnalité réelle est
proposée, écrire sa fixture et son ADR et la faire passer par PR 0 avant la création de la branche de la PR 3 ; en
l'absence de besoin démontré, ne rien ajouter. En parallèle, commencer PR 1, PR 2 et PR 4 dans des worktrees séparés. Reproduire avant de corriger. Pour le backup, valider et
borner avant toute écriture, partager une transaction SQL unique, refuser JSONL. Pour les artefacts, verrouiller les
packages, construire l'image une fois et publier ses vraies empreintes, cinq SBOM CycloneDX et l'attestation. Pour le
Field Kit, faire du bundle un objet autonome et borné. Ensuite seulement, mesurer le code final avec les ensembles de
mutation et les scénarios connecteurs, puis compléter la topologie de qualification.

Un pré-candidat technique peut éprouver la chaîne, sans aucune passe. Dans PR 6, recentrer les README anglais et français sur la création
d'un jeu, régénérer et inspecter les captures, publier honnêtement la maturité des surfaces. Le candidat final — le seul
sur lequel les passes commencent, et celui des tags — produit la baseline exacte comme artefact afin d'éviter toute
circularité avec son numéro de run. Taguer sans attendre les
passes, conformément à la décision du maintainer, mais ne promouvoir aucune surface et ne déclarer aucun GO 4.2 sans
la preuve humaine requise.
