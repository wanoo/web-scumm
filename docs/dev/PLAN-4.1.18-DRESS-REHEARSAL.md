# web-scumm 4.1.18 — Dress Rehearsal

> **Statut : en cours depuis la publication de v4.1.17 « Stabilization » (10 octobre 2026), décisions D32.**  
> **Base exacte :** le tag final `v4.1.17`, commit `dda1ab2e9b64c1779794cc2586aaccaa58b86491`, candidate run
> `38013477686` (vert, ses 8 fichiers vérifiés par `release.yml`, 20 attestations par `ship verify`). Le `rc.1` sur
> `0f5854f` n'a jamais été publié.  
> **Passes humaines :** une issue `field-pass` par passe (#75 à #87), fermée par le maintainer après son test.  
> **Nature :** qualification terrain, exploitation et distribution ; aucune nouvelle mécanique de jeu.  
> **Branche de préparation recommandée :** `docs/4118-dress-rehearsal`.  
> **But :** confronter les contrats prouvés par les machines à de vrais packages, un vrai déploiement, de vrais
> services, appareils et utilisateurs, puis transformer chaque échec en reproduction et en test avant 4.2.

## 1. Décision de version

La 4.1.17 ferme les défauts de vérité découverts après la 4.1.16 : un tag repose sur un candidate run du même SHA,
les charges SQLite et PostgreSQL mesurent réellement leur backend, le leaderboard classe avant de limiter, admission
et quota sont atomiques entre instances, les résultats de la roue peuvent être rejoués depuis leur transcript, les
sets de mutation `runs`, `remix` et `speedrun` sont bloquants, et les parcours Mystery, reprise et confinement du
worker atteignent la production.

Ce qui manque avant 4.2 n'est donc plus une grande primitive. La fiche 4.1.17 laisse treize passages humains non
réalisés et `docs/en/SUPPORT.md` conserve comme expérimentaux les connecteurs et le profil PostgreSQL distribué. Le
code possède déjà :

- `docs/en/FIELD.md` et les fiches Markdown de passes, mais pas de résultat structuré ni de bundle de diagnostic ;
- un set de mutation `connectors`, mesuré mais absent de `GATED` ;
- un set `reality-store`, lui aussi mesuré mais non bloquant ;
- `bridge/dev/docker-compose.yml`, qui ne lance que PostgreSQL pour le développement, pas une topologie complète ;
- `npm run fresh-install`, qui installe les quatre tarballs hors dépôt, mais sur un seul environnement, sans mise à
  niveau réelle de 4.1.17 vers le candidat et en réutilisant encore le harness e2e du dépôt ;
- les outils de collecte des sessions, de replay, de runs, de charge, de sauvegarde et de restauration nécessaires à
  une qualification terrain.

La 4.1.18 est donc une **répétition générale de la 4.2**. Elle ne promet pas qu'un essai humain réussira avant qu'il
ait eu lieu. Elle fournit d'abord les moyens reproductibles de l'exécuter, puis enregistre les résultats réels. D12
reste applicable : les passes humaines sont rapportées mais ne bloquent pas un tag 4.1.x. D18 reste applicable aussi :
la 4.2 ne peut qualifier de stable une surface dont la passe correspondante n'a pas réussi.

## 2. Résultat attendu

À la fin de la 4.1.18, une personne qui n'a pas développé web-scumm doit pouvoir :

1. installer les quatre archives du candidat sans accéder au checkout ;
2. créer, vérifier, construire, servir et mettre à niveau un jeu extérieur ;
3. déployer derrière HTTPS plusieurs Bridge reliés au même PostgreSQL ;
4. tuer une instance ou un worker sans perdre ni doubler un effet logique ;
5. connecter un véritable email, terminal SSH/Telnet et Open Badge dans un environnement contrôlé ;
6. jouer Story, Remix, Daily et Mystery, interrompre une run, redémarrer puis la reprendre ;
7. produire un rapport de terrain expurgé, lié au commit, au package, à l'appareil et aux preuves utiles ;
8. lire un rapport GO / NO-GO qui dit précisément quelles surfaces peuvent entrer dans 4.2.

La 4.1.18 peut être publiée avec une passe humaine encore rouge ou bloquée, conformément à D12. Elle ne peut pas
présenter cette surface comme qualifiée, et le rapport 4.2 doit alors soit la bloquer, soit proposer de la retirer du
périmètre stable.

## 3. Principes non négociables

1. **Une tentative n'est pas une réussite.** `not-run`, `blocked`, `failed` et `passed` restent distincts.
2. **La preuve vient du package candidat.** Aucun passage ne se contente du checkout si l'utilisateur final reçoit un
   tarball.
3. **Une surface est promue séparément.** Un email réel ne stabilise ni SSH, ni Open Badge, ni PostgreSQL.
4. **Aucun secret ni contenu privé n'entre dans Git.** Les bundles sont expurgés avant leur ajout ; le contrôle de
   fuite existant les inspecte.
5. **Chaque échec humain devient une reproduction minimale.** Si une machine peut ensuite le vérifier, le test rejoint
   la CI avant la correction.
6. **La qualification n'élargit pas le DSL gelé.** Les fixes respectent D28 ; une nouvelle primitive attend une autre
   décision et une autre version.
7. **Le déploiement de référence n'est pas un cloud propriétaire.** C'est un profil reproductible et documenté que
   l'opérateur peut porter ailleurs.
8. **Les tests de mutation ne tournent pas les charges sous chaque mutant.** Chaque set utilise des tests courts ; les
   charges et les races PostgreSQL restent des gates d'intégration séparées.
9. **La 4.1.18 ne contourne pas les décisions de la 4.2.** Pas de publication npm stable ni de tag signé anticipé sans
   décision du maintainer.
10. **Le candidate run reste la source de vérité.** Le SHA, les artefacts et les digests publiés sont ceux qu'il a
    jugés.

## 4. Phase A — Travail autonome avant les appareils et les personnes

Les quatre premières PR peuvent être réalisées sans compte de fournisseur, matériel particulier ni testeur. Elles
doivent fusionner dans cet ordre, chacune après seconde lecture et `pr-gate` vert.

## 5. PR 1 — `test/4118-field-contract` : le Field Kit

### 5.1 Problème vérifié

`docs/en/FIELD.md` décrit sept passes historiques et `docs/dev/passes/4.1.17.md` en énumère treize adaptées aux
surfaces récentes. La release lit les lignes Markdown contenant `not done`. Ce format est lisible, mais ne peut pas :

- vérifier que l'essai porte sur le bon SHA et les bons artefacts ;
- distinguer proprement échec, blocage et absence d'essai ;
- contrôler les champs nécessaires à une reproduction ;
- joindre et vérifier les empreintes des éléments de preuve ;
- générer le rapport de support sans interprétation manuelle.

### 5.2 Contrat proposé

Ajouter un schéma versionné, par exemple dans `tools/field/schema.ts` :

```ts
type FieldStatus = 'not-run' | 'blocked' | 'failed' | 'passed';

interface FieldReportV1 {
  schema: 1;
  passId: string;
  release: string;
  commit: string;
  candidateRun: string;
  packageDigests: Record<string, string>;
  status: FieldStatus;
  operator: string; // pseudonyme ou rôle ; aucune identité obligatoire
  startedAt: string;
  finishedAt: string;
  environment: {
    deviceFamily?: string;
    deviceModel?: string;
    os?: string;
    browser?: string;
    versions: Record<string, string>;
  };
  scenario: string;
  evidence: Array<{ path: string; sha256: string; kind: string }>;
  failures: Array<{
    step: string;
    expected: string;
    observed: string;
    reproducible: boolean;
    issue?: string;
  }>;
  notes?: string;
}
```

Le schéma doit refuser les champs inconnus pour éviter qu'un opérateur y mette par mégarde un token, une adresse
email ou une pièce jointe. Les logs restent des pièces séparées, passées par un expurgateur avant indexation.

### 5.3 Commandes

```text
npm run field:init -- --release=4.1.18 --candidate=<run>
npm run field:check -- --dir=.cache/field/4.1.18
npm run field:report -- --dir=.cache/field/4.1.18 --out=docs/dev/passes/4.1.18.md
npm run field:bundle -- --report=<report.json> --out=<bundle.tar.gz>
```

- `field:init` lit le manifeste du candidate run, crée les treize rapports à `not-run` et inscrit SHA et digests ;
- `field:check` valide schéma, cohérence temporelle, SHA, digests, présence et empreinte des preuves ;
- `field:report` génère la table Markdown et le résumé de release, sans changer le sens des anciens fichiers ;
- `field:bundle` copie seulement les preuves explicitement listées, les expurge, refuse les secrets connus et produit
  son propre manifeste SHA-256 ;
- `--require=<passId,...>` permet à la future gate 4.2 d'exiger certaines passes, mais **aucun `--require` humain ne
  devient bloquant pour 4.1.18** sans nouvelle décision.

### 5.4 Identifiants des treize passes

Les ids sont stables et indépendants du texte traduit :

```text
bridge-postgres-https
runs-real-players
run-resume-power-cycle
code-wheel-human
mystery-deployed
safari-ios-offline-update
firefox-real-offline
phone-both-renderers
livesplit-obs
connectors-real-security
blind-playtesters
voices-listening
archive-human-install
```

La documentation anglaise et française peut afficher un libellé, mais les outils et historiques utilisent l'id.

### 5.5 Tests écrits avant l'implémentation

- un rapport d'un autre commit est refusé ;
- une preuve absente ou dont le hash diffère est refusée ;
- `passed` sans date, environnement, scénario ou preuve est refusé ;
- `not-run`, `blocked` et `failed` ne sont jamais rendus comme `passed` ;
- un champ inconnu ou ressemblant à un secret est refusé ou expurgé selon sa place ;
- deux rapports du même `passId` ne peuvent pas être agrégés silencieusement ;
- le Markdown généré contient exactement les treize lignes et le bon décompte ;
- les anciennes fiches restent lisibles par `release-notes.mjs` ;
- `npm run audit` inspecte les rapports et bundles destinés à être committés.

### 5.6 Critère de sortie

Un faux rapport vert, un rapport d'un autre candidat ou un bundle dont une pièce a changé ne peut pas rendre une
passe réussie. La fiche 4.1.18 est générée depuis les rapports, mais reste diffable et lisible sans l'outil.

## 6. PR 2 — `test/4118-trust-mutation` : fermer les deux sets non gated

### 6.1 État vérifié

`tools/mutation-sets.ts` contient déjà :

- `connectors`, limité aux parties pures de SDK, MIME, terminal et badges ;
- `reality-store`, couvrant stores, migrations, streams et signature.

Ils tournent séparément, notamment la nuit, mais `GATED` ne contient que `core`, `reality`, `runs`, `remix` et
`speedrun`. Or la 4.1.18 veut précisément qualifier les connecteurs et PostgreSQL distribué.

### 6.2 Travail

1. mesurer chaque set à frais nouveaux sur le commit 4.1.17 ;
2. publier le nombre total, tué, survivant, timeout et erreur par fichier ;
3. lire chaque survivant séparément ;
4. ajouter le test minimal qui le tue ou documenter son équivalence exacte dans `docs/dev/mutants.json` ;
5. vérifier que le test échoue réellement avec le mutant seul et passe avec la source ;
6. ajouter `connectors` puis `reality-store` à `GATED` seulement lorsque leur rapport n'a plus de survivant inexpliqué ;
7. leur donner chacun un job, un timeout et un artefact propres dans CI, nightly et candidate.

### 6.3 Périmètre du set connectors

Le set actuel ne couvre pas toutes les décisions de confiance. Avant de le déclarer bloquant, dresser la table des
frontières et décider, mesure à l'appui, si les fichiers suivants rejoignent le set existant ou un court set
`connectors-runtime` distinct :

- validation de configuration et chargement des secrets ;
- client HTTP vers le Bridge, retry et déduplication ;
- vérification complète des badges et politique de fetch ;
- guard, shell et limites des terminaux ;
- authentication et fermeture SSH/Telnet ;
- décision webhook/IMAP et worker MIME.

Les sockets, fournisseurs réels et charges ne tournent pas sous chaque mutant. Leurs décisions pures sont extraites
si nécessaire ; leurs adaptateurs restent jugés par les tests d'intégration, l'abuse suite et le fuzzing.

### 6.4 Cas critiques à tenir

Les tests doivent rendre impossible de survivre à une mutation qui :

- élargit un host ou une adresse autorisée par la protection SSRF ;
- accepte HTTP, loopback, adresse privée ou redirect de trop pour un badge distant ;
- ignore expiration, issuer, recipient, statut ou révocation ;
- accepte une signature, un HMAC ou un Biscuit d'un autre contexte ;
- laisse une pièce jointe, un MIME trop profond ou trop grand atteindre le parser principal ;
- désactive limite de ligne, timeout, quota ou nombre de sessions ;
- permet exec, sftp, forwarding, traversal ou sortie du disque virtuel ;
- perd tenant, séquence, déduplication ou wake-up dans un store ;
- considère réussie une migration partielle ou une signature invalide.

### 6.5 Budget

- un job par set, jamais `connectors` puis `reality-store` dans le même job ;
- tests courts seulement sous mutation ;
- Postgres réel et fuzzing restent des jobs séparés ;
- le candidate gate affiche input hash, score, commit et équivalents nommés ;
- aucun relèvement de timeout avant profil du mutant ou du test qui consomme le budget.

### 6.6 Critère de sortie

`connectors` et `reality-store` sont gated avec zéro survivant inexpliqué, ou la PR garde honnêtement le set concerné
hors de `GATED` et ouvre un blocker 4.2. Une mesure partielle ne vaut pas une promotion.

## 7. PR 3 — `test/4118-external-consumer` : consommer les archives comme un tiers

### 7.1 État vérifié

`scripts/fresh-install.mjs` fait déjà un travail substantiel : il packe, crée deux jeux hors dépôt, installe et joue
le moteur, installe le Bridge et les connecteurs, refuse les chemins vers le checkout. Il reste cependant lié à un
seul environnement et utilise encore `scripts/e2e.mjs` depuis le dépôt pour finir le jeu. Il ne vérifie pas :

- la portabilité Windows/macOS/Linux du parcours complet ;
- une mise à niveau d'un projet installé en 4.1.17 ;
- une sauvegarde et une `.wsrun` produites avant l'upgrade puis consommées après ;
- l'usage de toutes les commandes sans aucun module du checkout ;
- l'installation manuelle des archives exactes du candidate run.

### 7.2 Travail

- rendre le harness portable : API Node plutôt que `mv`, groupes POSIX ou hypothèses de chemin lorsqu'elles gênent
  Windows ;
- déplacer le walkthrough minimal nécessaire dans le projet créé ou dans une API publique du package ; le test ne
  doit pas importer un runner interne du checkout ;
- exécuter la matrice sur Ubuntu, macOS et Windows, Node 22 et au moins une ligne Node 24 ;
- installer les quatre tarballs extraits du candidate run, jamais les reconstruire différemment dans la ligne qui les
  juge ;
- créer un jeu sur 4.1.17, produire une sauvegarde, une run schema 2 et un build ;
- installer le candidat 4.1.18, exécuter `migrate --check`, `verify`, `build`, charger la sauvegarde et vérifier la
  run ;
- installer séparément `web-scumm-bridge` avec SQLite puis avec le peer PostgreSQL ;
- installer `web-scumm-connectors` avec `--omit=optional --ignore-scripts`, lancer chaque `--help` et un scénario
  enregistré ;
- inspecter `npm pack --json` : noms, versions, licences, binaires, exports, fichiers et dépendances attendus ;
- refuser tout chemin absolu du checkout, import `@engine/*` interne ou dépendance `file:` involontaire.

### 7.3 Consommateur indépendant

Deux niveaux restent distincts :

1. **gate automatique** : projet jetable créé dans un dossier temporaire et matrice des OS ;
2. **passe humaine** : une personne télécharge les artefacts publiés par le candidat, suit uniquement leur README et
   rend son rapport `archive-human-install`.

Si The Lighthouse est rendu public, il devient le consommateur de référence. Sinon, un petit dépôt séparé sans lien
de workspace remplit ce rôle. Le plan ne suppose pas cette publication sans décision du maintainer.

### 7.4 Critère de sortie

Les quatre tarballs exacts du candidat s'installent hors checkout sur les trois OS, le jeu se termine, le Bridge
répond, les connecteurs exécutent leur scénario, et les artefacts 4.1.17 restent lisibles après mise à niveau.

## 8. PR 4 — `ops/4118-reference-deployment` : le profil de qualification

### 8.1 État vérifié

`bridge/dev/docker-compose.yml` ne contient qu'un PostgreSQL de développement. Le worker possède un profil de
conteneur testé, le Bridge possède health checks, stores, migrations, backup/restore et métriques, mais aucun fichier
ne compose encore l'ensemble dans la topologie que la documentation qualifie de distribuée.

### 8.2 Topologie

Ajouter un profil de qualification, séparé du compose de développement :

```text
client
  -> reverse proxy HTTPS
       -> bridge-1
       -> bridge-2
       -> bridge-3
            -> PostgreSQL 16
            -> workers confinés
            -> volumes de clés, configuration et audit
```

Le profil doit :

- pinner les images par digest ;
- construire les services depuis les tarballs candidats, pas depuis un bind mount du checkout ;
- exécuter les processus sans root, filesystem en lecture seule, `/tmp` borné, capabilities supprimées ;
- séparer le réseau public, le réseau Bridge et le réseau store ;
- ne jamais exposer PostgreSQL ni les ports d'administration ;
- monter secrets et tokens en fichiers avec permissions minimales ;
- fournir health, readiness, métriques et logs structurés sans secret ;
- définir volumes, sauvegarde, restauration et procédure de migration ;
- autoriser le TLS local pour la CI et documenter le certificat public pour la passe réelle ;
- rendre explicite le comportement de rolling upgrade : la migration de schéma est une opération contrôlée, pas le
  démarrage concurrent de deux versions incompatibles.

Le repo fournit un exemple reproductible, pas une promesse de sécurité universelle de Docker Compose.

### 8.3 Scénario automatisé de chaos

Ajouter une commande du type :

```text
npm run ops:qualify -- --profile=.cache/field/deployment.env --out=.cache/field/deployment
```

Elle doit au minimum :

1. vérifier les images et digests ;
2. migrer un store neuf puis un store 4.1.17 ;
3. envoyer des propositions sur plusieurs tenants et plusieurs instances ;
4. ouvrir un stream sur une instance pendant qu'une autre accepte les événements ;
5. soumettre Story, Remix, Daily et Mystery ;
6. tuer un Bridge puis le relancer ;
7. tuer un worker après son claim et vérifier la reprise de lease ;
8. remplir la file et vérifier admission et `Retry-After` ;
9. déclencher quotas et modération ;
10. sauvegarder, détruire la topologie, restaurer et comparer événements, runs, rangs, challenges et audit ;
11. vérifier zéro gap, zéro effet logique double et zéro croisement de tenant ;
12. produire un rapport JSON compatible avec le Field Kit.

### 8.4 Test d'endurance

La PR livre l'outil et un smoke court en CI. La passe humaine exécute ensuite 24 à 48 heures derrière un véritable
HTTPS/PostgreSQL avec :

- trafic continu et pointes ;
- redémarrage d'instance ;
- worker tué en vérification ;
- backup et restore ;
- observation du RSS, des latences p50/p95, de la file, des leases et des erreurs ;
- contrôle du nombre d'événements, d'effets, de runs et de rangs avant/après.

Les seuils numériques sont écrits dans la baseline **avant** le run long, à partir des mesures 4.1.17 et de la
machine utilisée. Ils ne sont pas choisis après coup pour rendre le rapport vert.

### 8.5 Critère de sortie

Le smoke automatisé détruit et reconstruit la topologie sans perte. Le profil réel reste `experimental` tant que le
run HTTPS de 24–48 h n'est pas passé et relu.

## 9. Phase B — Passages humains

Les PR 1 à 4 doivent être disponibles avant de solliciter des personnes. Elles rendent les essais courts,
reproductibles et exploitables. Les treize passes sont ensuite exécutées dans l'ordre suivant.

## 10. PR 5 — `field/4118-operations` : déploiement, connecteurs et runs réels

### 10.1 Bridge distribué

Exécuter le profil de qualification derrière un domaine HTTPS réel et PostgreSQL :

- au moins trois instances ;
- un worker tué pendant une vérification ;
- une instance redémarrée pendant un stream ;
- backup/restore ;
- contrôle des tenants et quotas ;
- rapport `bridge-postgres-https`.

### 10.2 Runs de personnes

Des personnes autres que l'auteur soumettent :

- Story ;
- Remix Fixed ou Random ;
- Daily ;
- Mystery depuis le menu relié au Bridge.

Une run est interrompue par arrêt complet de la machine, pas seulement par reload de page, puis reprise. Les rapports
`runs-real-players`, `mystery-deployed` et `run-resume-power-cycle` gardent les `.wsrun`, verdicts, catégorie,
leaderboard, monde et seed nécessaires, jamais une identité réelle obligatoire.

### 10.3 Connecteurs réels

Exécuter séparément :

- email par un fournisseur webhook ou IMAP réel ;
- SSH exposé dans un environnement contrôlé ;
- Telnet uniquement sur réseau local, VPN ou tunnel TLS explicitement documenté ;
- Open Badge OB2 ou OB3 provenant d'un issuer réel, avec un cas valide et si possible un statut/révocation.

La revue humaine de sécurité tente au minimum : mauvais tenant, mauvais token, replay, doublon, payload trop grand,
client lent, quota, déconnexion/reprise, SSRF, attachment, badge expiré/révoqué, exec/sftp/forwarding et traversal.
Chaque connecteur obtient son sous-verdict. `connectors-real-security` n'est `passed` que si les quatre sous-verdicts
requis par la surface annoncée ont réussi ; sinon les docs conservent une promotion individuelle ou le statut
expérimental.

### 10.4 Règle de correction

Un défaut découvert n'est pas corrigé directement dans la branche de preuves. Ouvrir `fix/4118-field-<id>` avec :

1. le rapport expurgé ;
2. la reproduction automatique ou la raison précise pour laquelle elle reste humaine ;
3. le test rouge ;
4. le correctif minimal ;
5. la nouvelle passe sur le même type d'environnement.

## 11. PR 6 — `field/4118-player` : appareils, accessibilité, audio et speedrun

### 11.1 PWA et renderers

- iPhone réel : installation Safari, première visite, avion, salle non visitée, reload, puis mise à jour avec sauvegarde
  durable ;
- Firefox sur une vraie machine : installation, offline, reload et update ;
- téléphone réel : scène lourde avec DOM puis Canvas, DPR réel, touch, rotation si supportée, minimum FPS observé ;
- comparaison logique des deux renderers, pas seulement une capture ressemblante.

Rapports : `safari-ios-offline-update`, `firefox-real-offline`, `phone-both-renderers`.

### 11.2 Lecteur d'écran et roue

- VoiceOver iOS, TalkBack Android ou NVDA selon le matériel disponible ;
- titre, menu, scène, hotspot, inventaire, dialogue, minijeu, pause, reprise et fin ;
- roue imprimée réellement manipulée à table ;
- alternative textuelle utilisée par une personne avec lecteur d'écran ;
- retour de focus et annonces après le minijeu.

Rapport : `code-wheel-human`. Axe reste une gate automatique, mais ne remplace pas ce passage.

### 11.3 Speedrun locale

- LiveSplit réel connecté à l'autosplitter ;
- overlay réel capturé dans OBS ;
- split, pause, save/load, resume, fin et arrêt ;
- comparaison du temps affiché, du temps scellé et du verdict du vérificateur.

La limite connue de 4.1.17 — l'affichage live RTA après reprise peut compter avant le début de la run alors que les
temps scellés sont justes — doit produire un test puis un correctif dans ce lot si elle est encore présente.

Rapport : `livesplit-obs`.

### 11.4 Playtests et voix

- cinq personnes ne connaissant pas les puzzles ;
- au moins trois fins et deux familles d'appareils, selon `verify:field` ;
- sessions exportées, stalls, hints, near misses et abandons analysés ;
- voix représentatives et scores écoutés sur téléphone et casque, transitions, ducking, bridge et reprise de save.

Rapports : `blind-playtesters` et `voices-listening`.

### 11.5 Installation humaine

Une personne qui n'a pas écrit le harness télécharge les quatre archives du candidat et suit uniquement les README
embarqués. Elle ne reçoit ni commande privée ni chemin vers le dépôt. Son rapport `archive-human-install` doit dire
où elle a hésité autant que ce qui a cassé.

## 12. Phase C — Corrections, qualification et release

## 13. PR de correction — `fix/4118-field-*`

Les corrections viennent après les deux PR de terrain et restent séparées par responsabilité. Une PR ne regroupe pas
« tous les retours humains » si ceux-ci touchent PWA, Bridge, connecteurs et accessibilité sans lien.

Priorité :

1. P0 : perte de données, isolation, secret, contournement de preuve, artefact différent du candidat ;
2. P1 : impossibilité d'installer, déployer, jouer, reprendre ou administrer une surface annoncée ;
3. P2 : accessibilité, ergonomie, documentation ou performance sans perte de contrat ;
4. P3 : confort et polish, reportables avec une limite explicite.

Tout P0/P1 issu d'une passe doit être fermé ou retirer la surface du périmètre 4.2. Il ne peut pas être reclassé en
« connu » seulement pour tenir une date.

Après une correction qui change le package ou la topologie, les rapports antérieurs concernés ne valent plus pour
le nouveau SHA. Ils sont rejoués sur le candidat suivant ; le Field Kit doit le rendre visible.

## 14. PR 7 — `release/4.1.18` : vérité de support et GO / NO-GO 4.2

### 14.1 Documents

- `CHANGELOG.md` ;
- `README.md` et `README.fr.md` seulement pour les capacités réellement qualifiées ;
- `docs/en` et `docs/fr` pour Field, Support, Reality Ops, Connectors, Tools et Upgrading ;
- `docs/dev/baselines/4.1.18.md` ;
- `docs/dev/passes/4.1.18.md`, généré depuis les rapports ;
- `docs/dev/GO-NO-GO-4.2.md` ;
- entrée de LOG avec commandes, mesures, ce qui n'a pas été fait et passation.

### 14.2 Matrice de décision par surface

Le rapport 4.2 ne donne pas un verdict global vague. Il classe au minimum :

| Surface | Preuve machine | Preuve humaine | Verdict 4.2 |
|---|---|---|---|
| Player DOM | navigateurs, e2e, axe | téléphones et lecteur d'écran | stable / limitée / bloquée |
| Player Canvas | équivalence logique, perf | téléphone réel | stable / expérimentale / retirée |
| PWA Chromium | CI offline/update | installation réelle si faite | stable / limitée |
| PWA Safari | WebKit CI | iPhone Safari | stable / limitée / non supportée |
| Firefox | PWA CI | machine réelle | stable / PWA seulement / non supportée |
| Bridge SQLite | contrats, charge, backup | installation longue si faite | stable / limitée |
| Bridge PostgreSQL | store, load, chaos | HTTPS 24–48 h | stable / expérimental |
| Email | tests, fuzz, mutation | fournisseur réel | stable / expérimental |
| SSH | tests, abuse, mutation | exposition contrôlée | stable / expérimental |
| Telnet | tests, abuse, mutation | réseau contrôlé | stable / expérimental |
| Open Badge | fixtures, SSRF, mutation | issuer réel | stable / expérimental |
| Speedrun / Remix | replay, worlds, candidate | personnes, OBS/LiveSplit | stable / limitée |
| Studio | e2e, OS CI | essai humain par OS | stable / support partiel |

Seul `passed` permet de lever `experimental`. Un succès sur une sous-surface ne promeut pas les autres.

### 14.3 Candidate gate 4.1.18

Le candidate run conserve les familles 4.1.17 et ajoute :

- mutation `connectors` ;
- mutation `reality-store` ;
- fresh install externe sur les OS décidés ;
- upgrade 4.1.17 vers 4.1.18 depuis les tarballs ;
- smoke du profil de déploiement et chaos court ;
- validation de tous les rapports et bundles présents ;
- génération du rapport de passes et du GO / NO-GO ;
- vérification que les docs n'ont promu aucune surface sans rapport `passed`.

Les longues passes humaines et le soak 24–48 h ne sont pas relancés dans GitHub Actions. Le candidat vérifie leur
rapport, leur lien au SHA/package et leurs preuves. Si un correctif change ce SHA, les rapports touchés redeviennent
invalides jusqu'à leur reprise.

### 14.4 Release

- RC recommandée, car le profil de déploiement et les packages changent ;
- `v4.1.18-rc.1` puis stable sur le même commit si aucun correctif n'est nécessaire ;
- sinon nouveau SHA, nouveau candidate run et nouvelle RC ;
- le stable est tagué uniquement par `ship tag --candidate=<run>` ;
- les artefacts publiés sont ceux du candidate run et leurs digests sont revérifiés ;
- le tag reste non signé si D30 n'est pas modifiée ; la signature appartient alors toujours à 4.2 ;
- aucune publication npm stable en 4.1.18 sans décision explicite modifiant D18.

## 15. Ordre des PR

| Ordre | Branche | Peut se faire sans humain | Dépend de |
|---:|---|:---:|---|
| 1 | `test/4118-field-contract` | oui | v4.1.17 publié |
| 2 | `test/4118-trust-mutation` | oui | PR 1 seulement pour les rapports |
| 3 | `test/4118-external-consumer` | oui | artefacts 4.1.17 et harness portable |
| 4 | `ops/4118-reference-deployment` | oui pour le profil et le smoke | PR 1, packages de PR 3 |
| 5 | `field/4118-operations` | non | PR 1–4, comptes/services/domaine |
| 6 | `field/4118-player` | non | PR 1–4, appareils et personnes |
| 6+n | `fix/4118-field-<id>` | selon le défaut | rapport qui le reproduit |
| dernier | `release/4.1.18` | partiellement | toutes les corrections retenues |

Les PR 2, 3 et 4 ne sont pas développées en parallèle si elles touchent le candidate workflow ou le packer au même
moment. Leur ordre fixe la source des artefacts : qualité des frontières, consommation des packages, puis topologie
construite depuis ces packages.

## 16. Commandes de validation

Minimum de chaque PR selon son périmètre :

```bash
npm run quality
npm run docs:truth
npm run test:node
npm run build:game
npm run quality:baseline -- --check --dist
```

PR mutation :

```bash
npm run test:mutation:core -- --set=connectors --fresh
npm run test:mutation:core -- --set=reality-store --fresh
```

PR packages :

```bash
npm run pack -- --out=.cache/pack --publish-dry-run
npm run fresh-install -- --keep
npm run upgrade-check -- --from=4.1.17
```

PR déploiement :

```bash
npm run ops:qualify -- --profile=.cache/field/deployment.env --out=.cache/field/deployment
npm run bridge:load -- --store=<postgres> --out=.cache/field/bridge-load.json
npm run runs:load -- --store=<postgres> --runs=100000 --out=.cache/field/runs-load.json
```

Avant la RC :

```bash
npm run field:check -- --dir=.cache/field/4.1.18
npm run release-check:local
npm run test:heavy
npm run e2e:canonical
npm run e2e:remix-speedrun
```

Le candidate workflow exécute le reste sur le SHA exact. Aucun résumé manuel ne remplace ses artefacts.

## 17. Points à trancher par le maintainer

| # | Décision | Recommandation |
|---:|---|---|
| 1 | Nom de la release | `4.1.18 « Dress Rehearsal »`, dernière qualification avant `Stable World` |
| 2 | D12 en 4.1.18 | inchangée : rapporter sans bloquer le tag ; bloquer seulement la promotion 4.2 |
| 3 | Source des passes | rapports JSON versionnés et expurgés ; Markdown généré pour les humains |
| 4 | Publication des preuves | commit des rapports et petits artefacts expurgés ; gros bundles en artefacts de run, jamais de secrets |
| 5 | Sets mutation | rendre `connectors` et `reality-store` bloquants après lecture complète |
| 6 | Déploiement réel | un domaine HTTPS temporaire, trois Bridge, PostgreSQL et worker confiné pendant 24–48 h |
| 7 | Fournisseur email | choisir webhook ou IMAP réel ; l'autre reste testé automatiquement mais non qualifié humainement |
| 8 | Badge réel | choisir un issuer OB2/OB3 accessible et publiable sans données personnelles |
| 9 | Consommateur indépendant | publier The Lighthouse, ou créer un dépôt minimal séparé si son contenu doit rester local |
| 10 | OS de la gate packages | Ubuntu + Windows + macOS recommandés ; Node 22 partout, Node 24 au moins sur Ubuntu |
| 11 | Promotion partielle | oui : une surface peut rester expérimentale sans bloquer les autres, mais la 4.2 doit l'annoncer |
| 12 | Tag et npm | garder signature et publication npm stable pour 4.2, conformément à D30/D18 |

Ces décisions sont écrites dans `docs/dev/DECISIONS.md` avant le lot qu'elles affectent. Le plan peut commencer par
les choix recommandés sans engager de compte externe ; il s'arrête avant un déploiement ou une publication qui exige
une autre autorité.

## 18. Critères de sortie de la 4.1.18

La 4.1.18 ne doit pas être taguée tant que l'un de ces critères automatiques est faux :

1. son candidate run ne vise pas le SHA exact du tag ;
2. les quatre tarballs jugés ne sont pas ceux que la release publiera ;
3. `connectors` ou `reality-store` contient un survivant inexpliqué tout en étant présenté comme gated ;
4. l'installation externe échoue sur un OS annoncé comme supporté ;
5. un projet 4.1.17 ne peut pas être mis à niveau, construire, charger sa sauvegarde ou vérifier sa run ;
6. le smoke distribué perd, double ou croise un effet, une run ou un tenant ;
7. backup/restore ne restitue pas événements, challenges, runs et classements attendus ;
8. un rapport `passed` n'est pas lié au bon commit, aux bons digests et à ses preuves ;
9. un secret ou contenu privé apparaît dans un rapport publié ;
10. la matrice de support promeut une surface sans passe correspondante réussie ;
11. un P0/P1 de terrain reste ouvert sans retrait explicite de la surface concernée ;
12. le GO / NO-GO 4.2, les limites et les passes non réalisées ne sont pas publiés.

Conformément à D12, une passe humaine `not-run`, `blocked` ou `failed` ne bloque pas mécaniquement le tag 4.1.18. Elle
doit cependant apparaître dans les notes et interdit de déclarer la surface qualifiée pour 4.2.

## 19. Conditions pour ouvrir la 4.2

La 4.2 peut commencer lorsque :

- chaque surface destinée au support stable possède ses preuves machine et humaine ;
- toutes les autres sont explicitement limitées, expérimentales ou retirées ;
- aucun P0/P1 de terrain n'est ouvert ;
- un consommateur extérieur utilise les archives sans le checkout ;
- le rapport GO / NO-GO est approuvé ;
- la procédure de publication npm et de signature peut être répétée sans modifier le code candidat.

La 4.2 peut alors se concentrer sur son vrai contrat : publication npm, tag signé, politique SemVer durable, support
annoncé et documentation finale — sans y découvrir pour la première fois comment le moteur se comporte sur le terrain.

## 20. Hors périmètre

- nouveau connecteur ;
- nouvelle primitive DSL, nouveau format de dialogue ou nouveau mode Remix ;
- identité générale des joueurs et anti-cheat absolu ;
- nouveau renderer, Phaser, physique générale ou WebGL sans mesure ;
- nouvelle recherche du solveur ouvert à trois personnages ;
- refonte générale du Studio ;
- changement de schema de sauvegarde ou `.wsrun` sans défaut de terrain bloquant ;
- objectif de 130 KB obtenu au prix d'un contrat ou d'une fonction ; le budget bloquant reste celui décidé ;
- service cloud web-scumm hébergé par le projet ;
- certification WCAG fondée sur le seul passage axe ou une seule personne ;
- affirmation que `replay-valid` prouve l'identité ou l'absence d'assistance ;
- publication npm stable et signature du tag, réservées à 4.2 sauf décision contraire.

## 21. Définition du succès

La 4.1.18 est réussie quand la phrase suivante est littéralement vraie :

> Les archives testées s'installent hors du dépôt ; un Bridge distribué a survécu aux pannes et à une restauration ;
> les surfaces annoncées ont été essayées par des personnes sur les appareils et services qu'elles prétendent
> supporter ; chaque échec est reproductible ; et la 4.2 sait exactement ce qu'elle peut promettre.

La 4.1.17 rend les preuves automatiques crédibles. La 4.1.18 décide, par l'expérience plutôt que par l'intention,
lesquelles de ces capacités sont prêtes à devenir un contrat stable.
