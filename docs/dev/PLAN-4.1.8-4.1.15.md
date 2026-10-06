# web-scumm — plan 4.1.8 à 4.1.15

> **Statut : proposition de programme après v4.1.7.**  
> **Base :** tag `v4.1.7`.  
> **But :** profiter de l'absence actuelle de jeu de production dépendant du moteur pour terminer les ruptures
> d'architecture avant de figer les contrats en v4.2.

## 1. Décision de programme

Aucun jeu de production ne dépend aujourd'hui de web-scumm. Les sauvegardes, projets externes et API de la ligne 4.1
ne constituent donc pas encore un parc à préserver à tout prix. Les jeux `demo`, `reference`, `_template` et les
fixtures restent des oracles de comportement, mais pas une contrainte de compatibilité publique.

La ligne `4.1.x` est par conséquent traitée comme une ligne d'incubation :

- les ruptures nécessaires sont autorisées et documentées ;
- chaque rupture fournit une migration pour les contenus officiels lorsqu'elle est utile à la validation ;
- aucune couche de compatibilité durable n'est ajoutée uniquement pour préserver une API encore inutilisée ;
- chaque version doit néanmoins partir d'une baseline mesurée et finir avec des contrôles reproductibles ;
- la v4.2 rétablit un SemVer strict et devient le premier contrat durable de cette série.

Cette liberté ne dispense pas de qualité. Une rupture volontaire doit être plus simple à expliquer, plus facile à
tester et moins coûteuse à maintenir que ce qu'elle remplace.

## 2. Vue d'ensemble

| Version | Nom de travail | Résultat attendu |
|---|---|---|
| 4.1.8 | **Foundation Reset** | TypeScript 7, Vite 8, PWA 2, intégrité Reality et chaîne de release honnête |
| 4.1.9 | **Gateways** | Connecteurs email, SSH, Telnet et Open Badges sur un SDK commun |
| 4.1.10 | **Constellation** | Bridge distribué, durable et multi-tenant |
| 4.1.11 | **Viewport** | Nouveau renderer indépendant de la logique du jeu |
| 4.1.12 | **Language** | DSL et représentation intermédiaire adaptés aux capacités nouvelles |
| 4.1.13 | **Proof at Scale** | Preuve scalable d'une classe publiée de jeux ouverts à trois personnages |
| 4.1.14 | **Time Attack** | Speedrun, splits, ghosts, replays vérifiables et classements |
| 4.1.15 | **Remix** | Parties à variance contrôlée, déterministes par seed et contraintes de solvabilité vérifiables |
| 4.2.0 | **Stable World** | Gel des contrats, package stable et premier jeu réel de référence |

L'ordre est intentionnel : les dépendances et l'intégrité sont corrigées avant les connecteurs ; les connecteurs
éprouvent le Bridge avant sa distribution ; le renderer précède les primitives de mise en scène ; le socle du DSL est
stabilisé avant de réinvestir massivement dans le solveur ; le système de speedrun réutilise ensuite le replay, le
solveur et le Bridge stabilisés ; Remix réutilise enfin ses seeds, preuves et paquets de replay pour produire des
parties variées sans sacrifier le déterminisme. Le gel final du langage intervient après cette dernière extension.

## 3. Règles communes à chaque version

Chaque lot commence par une mesure et se termine par une preuve :

1. écrire une fixture ou un test qui expose le besoin avant l'implémentation ;
2. produire une ADR pour tout nouveau contrat transversal ;
3. garder le cœur déterministe et le contenu déclaratif ;
4. propager toute primitive au runtime, au validateur, au solveur, au replay, au Studio, au MCP et à la documentation ;
5. ne jamais annoncer `proved`, `verified` ou `delivered` lorsqu'un budget ou une vérification a été interrompu ;
6. mesurer bundle, mémoire, temps de build, temps de preuve et couverture contre la version précédente ;
7. tester les artefacts emballés et non seulement le checkout du dépôt ;
8. conserver un journal des décisions et des limites connues ;
9. produire une fiche de passage humain même lorsque celle-ci n'est pas encore bloquante ;
10. n'ouvrir le lot suivant qu'après fermeture des bloqueurs du lot courant.

Les changements de fonctionnalités ne doivent pas servir de prétexte à une réécriture générale. Les refactorisations
restent locales, couvertes par des tests de caractérisation et reliées à un risque mesuré.

---

## 4. v4.1.8 — Foundation Reset

### 4.1 Objectif

Moderniser la fondation technique avant l'ajout de nouvelles surfaces :

- TypeScript 7 ;
- Vite 8 ;
- plugin PWA 2 ;
- correction de l'intégrité de livraison Reality ;
- tests et mutations réellement bloquants ;
- diagnostic, packaging et release cohérents ;
- première réduction ciblée de la dette du Studio.

La v4.1.8 peut casser des types ou scripts internes. Elle ne doit pas ajouter une nouvelle primitive de gameplay.

### 4.2 Baseline avant migration

- Figer les résultats exacts de v4.1.7 : tests, couverture, mutations, bundle, build et preuves.
- Conserver le tag et ses artefacts comme oracle.
- Ajouter un test rouge reproduisant le saut d'un signal Reality non acquitté.
- Capturer les surfaces API et les formats d'artefacts existants.
- Rejouer `demo`, `reference`, le jeu généré et le second jeu depuis une installation fraîche.
- Documenter les incompatibilités connues de TypeScript 7, Vite 8 et PWA 2 avant toute modification.

### 4.3 TypeScript 7

- Migrer moteur, DOM, Studio, outils et Bridge.
- Remplacer les options retirées (`baseUrl`, anciens usages de `paths` ou équivalents) par une résolution explicite.
- Activer le profil `strictest` sur le Bridge.
- Étendre progressivement `noUncheckedIndexedAccess` aux outils de production.
- Classer les exports : public, extension, outil interne ou détail d'implémentation.
- Supprimer ou internaliser les exports accidentels plutôt que les déprécier inutilement.
- Régénérer la documentation API et rendre lisibles les alias simples (`Id`, `Point`, `Keyring`).
- Faire échouer la CI si un export public n'a ni description ni stabilité déclarée.

### 4.4 Vite 8

- Migrer les plugins de jeu, du Studio et les routes virtuelles.
- Corriger les imports CommonJS/ESM au lieu d'ajouter un shim global opaque.
- Vérifier `dev`, `studio`, `preview`, `dev:lan`, les pages d'outils et les commandes emballées.
- Tester les imports dynamiques des minijeux et des renderers.
- Comparer les chunks et le poids de première visite à v4.1.7.
- Remplacer le script `start` dépendant d'une expansion shell Unix par un lanceur Node portable.
- Ajouter un smoke test Windows pour `doctor`, `check`, `build` et `preview`.

Une augmentation de plus de 10 % du poids initial ou du temps de build exige une justification écrite.

### 4.5 PWA 2

- Migrer le manifest et le service worker.
- Nommer et versionner les caches.
- Nettoyer les caches obsolètes sans supprimer une sauvegarde.
- Ne jamais recharger pour activer une mise à jour avant la confirmation d'une sauvegarde durable.
- Tester installation, démarrage hors ligne, reprise, mise à jour, interruption de mise à jour et réinstallation.
- Tester une montée de v4.1.7 vers v4.1.8, même si sa compatibilité n'est pas un contrat public.
- Vérifier Chromium, WebKit et Firefox sur le build final.

### 4.6 Intégrité Reality — bloqueur P0

Le port HTTP de v4.1.7 avance son curseur lors de la livraison, avant application, sauvegarde et acquittement. Une
erreur temporaire peut donc faire reprendre la connexion après un signal qui n'a jamais été appliqué.

Travail attendu :

- séparer curseur reçu, curseur livré et curseur durable ;
- avancer le curseur durable uniquement après application, sauvegarde et ACK réussis ;
- après un refus ou une erreur, reprendre depuis le dernier curseur durable ;
- tester polling et SSE aux frontières de récupération de clé, signature, application, sauvegarde, ACK et réseau ;
- garantir l'idempotence des doublons et l'ordre des séquences ;
- borner taille d'une frame, buffer du parseur et backlog SSE ;
- accepter `LF` et `CRLF` ;
- ajouter une éviction LRU au cache de resignature ;
- valider intégralement les entrées du journal ;
- détecter ou refuser deux processus utilisant le même journal mono-instance.

**Critère absolu :** aucun signal non acquitté ne peut être sauté pendant une session ou après une reconnexion.

### 4.7 Falsification et release

- Éliminer ou classifier les survivants de mutation Reality ; seuls les équivalents démontrés restent autorisés.
- Retirer `continue-on-error` du jeu de mutation critique.
- Exécuter le ratchet de couverture en mode strict et remonter les seuils près des mesures de v4.1.7.
- Ajouter `doctor --release` avec Python, Pillow, NumPy, ffmpeg et navigateurs requis.
- Séparer explicitement les tests Node des tests d'assets Python.
- N'empaqueter que des fichiers suivis par Git ; refuser les fichiers non suivis sous une racine distribuée.
- Tester toutes les archives, y compris `create-web-scumm` et le Bridge compilé.
- Ajouter `npm publish --dry-run`, même avant publication effective sur npm.
- Vérifier checksum, SBOM et attestation après construction.
- Corriger les contradictions de documentation, licences, compteurs de tests et poids du bundle.

### 4.8 Maintenabilité ciblée

- Découper progressivement les trois plus gros onglets du Studio en modèle, IO/API et vue.
- Ajouter des tests DOM au niveau de chaque composant extrait.
- Viser moins de 1 000 lignes par nouveau fichier et moins de 800 lorsque la responsabilité est unique.
- Ne pas réécrire tout le Studio dans cette version.

### 4.9 Critères de sortie

- TypeScript 7, Vite 8 et PWA 2 sont actifs, sans shim temporaire non documenté.
- Chromium, WebKit, Firefox et le smoke Windows sont verts.
- Aucun signal Reality non acquitté n'est sauté en polling ou SSE.
- La mutation Reality critique et le ratchet de couverture sont bloquants.
- `doctor --release` prédit honnêtement `release-check`.
- Chaque archive distribuée est installable dans un dossier vierge.
- Bundle et performances sont comparés à v4.1.7.
- La documentation ne contient plus de faits contradictoires connus.

---

## 5. v4.1.9 — Gateways

### 5.1 Objectif

Livrer quatre connecteurs réels — email, SSH, Telnet et Open Badges — sans introduire de socket, de secret ni de
contenu exécutable dans la PWA ou le DSL.

### 5.2 SDK commun de connecteurs

```ts
interface RealityConnector {
  readonly id: string;
  start(context: ConnectorContext): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<ConnectorHealth>;
}
```

Chaque connecteur :

- reçoit un événement externe ;
- le valide et le normalise ;
- l'associe à un tenant, un jeu, un joueur et une session ;
- fournit une clé d'idempotence ;
- présente un Biscuit limitant les signaux qu'il peut proposer ;
- laisse le Bridge attribuer la séquence et signer le signal final ;
- applique quotas, tailles maximales et délais ;
- journalise sans secret ni contenu personnel inutile ;
- expose health, métriques et arrêt propre.

Les connecteurs tournent hors du processus du jeu. Leur entrée est toujours non fiable.

### 5.3 Email

- Mode webhook fournisseur pour la production.
- Mode IMAP pour développement et installation personnelle.
- Extraction sûre de l'expéditeur, du destinataire, du sujet et du corps textuel.
- HTML rendu inerte ; pièces jointes refusées par défaut et limitées par politique.
- Allowlist, anti-rejeu, idempotence et adresse dédiée par joueur ou partie.
- Réponses optionnelles à partir de templates contrôlés.
- Rétention minimale et suppression explicite des messages.

### 5.4 Telnet

- Serveur séparé du Bridge principal.
- Protocole textuel et shell entièrement virtuel.
- Session associée par capability à un joueur.
- Commandes déclarées par le jeu, jamais transmises au système hôte.
- Limites de taille, débit, durée et connexions.
- Tests des entrées binaires, lentes, tronquées et malformées.

### 5.5 SSH

- Authentification par clé ou capability temporaire.
- Terminal, commandes et système de fichiers virtuels.
- Aucun shell, processus, chemin ou variable de l'hôte exposé.
- Redimensionnement du terminal et reprise contrôlée.
- Journal expurgé et durée de session limitée.
- Isolation du parseur et tests de commandes hostiles.

### 5.6 Open Badges

- Vérification distincte des formats Open Badges 2 et 3.
- Vérification preuve/signature, émetteur, bénéficiaire, expiration et révocation.
- Politique réseau explicite pour la récupération des documents liés.
- Cache borné avec durée et provenance.
- Résultat normalisé : `valid`, `invalid`, `expired`, `revoked` ou `indeterminate`.
- Le jeu ne reçoit jamais le document brut comme autorité.

### 5.7 Validation

- Environnement local reproductible pour chaque connecteur.
- Tests contractuels communs au SDK.
- Tests de sécurité sur contenus, tailles, délais et permissions Biscuit.
- Exemple jouable combinant au moins email et terminal.
- Replays déterministes des signaux enregistrés sans dépendre du réseau.

### 5.8 Critères de sortie

- Les quatre connecteurs passent le même contrat et les mêmes tests d'abus.
- Une livraison répétée ne produit qu'un effet logique.
- Aucun connecteur ne peut exécuter du code arbitraire sur l'hôte.
- Un jeu peut fonctionner sans les connecteurs et sans code serveur dans son bundle.
- Les données personnelles et leurs durées de conservation sont documentées.

---

## 6. v4.1.10 — Constellation

### 6.1 Objectif

Faire évoluer le Bridge de référence mono-instance vers un service durable, horizontalement réplicable et isolé par
tenant, sans changer le protocole reçu par le moteur.

### 6.2 Identité et isolation

Toute opération porte explicitement :

- `tenantId` ;
- `gameId` ;
- `playerId` ;
- `sessionId` ;
- `connectorId` ;
- `signalId` ;
- clé d'idempotence ;
- séquence et état d'acquittement.

Chaque requête, index, journal et métrique doit être filtré par tenant. Les tests tentent systématiquement de croiser
deux tenants.

### 6.3 Stockage durable

```ts
interface RealityStore {
  appendSignal(input: ProposedSignal): Promise<StoredSignal>;
  acknowledge(input: Acknowledgement): Promise<void>;
  listAfter(cursor: SignalCursor): Promise<StoredSignal[]>;
  rotateKeys(input: Rotation): Promise<void>;
}
```

Implémentations :

- mémoire pour tests ;
- SQLite pour développement et petite installation ;
- PostgreSQL pour distribution.

Le journal JSONL reste un outil de migration ou d'audit, pas le backend distribué.

### 6.4 Distribution

- Instances Bridge stateless.
- Séquences, idempotence et ACK transactionnels en base.
- Pas de sticky session obligatoire.
- Fan-out SSE entre instances.
- Backpressure et quarantaine des événements invalides.
- Reprise après arrêt brutal.
- Migrations de schéma versionnées, avant et arrière lorsque possible.
- Une même proposition concurrente produit un seul signal canonique.

### 6.5 Sécurité et exploitation

- Clés, quotas et politiques Biscuit distincts par tenant.
- Rotation et révocation indépendantes.
- Journal d'audit exportable.
- Export et suppression d'un tenant.
- `trust-proxy` limité à une allowlist de proxies ou réseaux.
- OpenTelemetry : ingestion, ACK, retries, backlog, erreurs, quarantaine et latence.
- Health, readiness, liveness, sauvegarde et restauration.
- Procédures documentées de compromission, rotation et reprise.

### 6.6 Critères de sortie

- Trois instances traitent un même flux sans perte ni effet dupliqué.
- L'arrêt brutal d'une instance ne rompt pas l'ordre durable.
- L'isolation entre tenants est testée en propriété et en intégration.
- Sauvegarde et restauration sont réellement rejouées.
- Un test de charge reproductible publie débit, latence et limites.
- Le Bridge mono-instance reste disponible comme profil local simple.

---

## 7. v4.1.11 — Viewport

### 7.1 Objectif

Créer un renderer moderne sans déplacer la logique de gameplay dans une bibliothèque graphique. Le DOM existant reste
temporairement l'oracle comportemental.

### 7.2 Contrat de rendu

Le moteur produit une scène immuable :

```ts
interface SceneFrame {
  camera: CameraState;
  layers: readonly RenderLayer[];
  actors: readonly RenderActor[];
  hotspots: readonly RenderHotspot[];
  effects: readonly RenderEffect[];
}
```

Le renderer affiche cette scène et traduit les entrées en intentions. Il ne modifie jamais directement `GameState`.
Le solveur et le replay ne dépendent d'aucun renderer.

### 7.3 Choix technique

- Mesurer Canvas 2D et WebGL/PixiJS sur les scènes de référence.
- Ne retenir Phaser que si ses systèmes apportent un bénéfice mesuré supérieur à son poids et à son chevauchement
  avec le moteur web-scumm.
- Conserver un backend simple pour les tests et les environnements sans accélération.
- Décider par ADR après prototype, pas par préférence.

### 7.4 Capacités

- Décors multicouches et plans de premier plan.
- Parallaxe.
- Masques d'occlusion arbitraires.
- Plusieurs zones marchables et portails entre zones.
- Caméra horizontale, verticale et zoom.
- Transitions et timelines.
- Particules et éclairage 2D.
- Hit-testing précomputé et cohérent avec le visuel.
- Restauration après perte du contexte graphique.

Une couche DOM sémantique synchronisée conserve boutons de hotspots, focus, clavier et lecteur d'écran.

### 7.5 Validation

- Captures de référence et tests visuels.
- Équivalence des intentions entre DOM et nouveau renderer.
- DPR 1, 2 et 3 ; écran mobile et desktop.
- Budgets CPU, GPU, mémoire et batterie.
- Téléphone d'entrée de gamme.
- `prefers-reduced-motion` et options de contraste.
- Aucun changement du résultat d'un replay selon le renderer.

### 7.6 Critères de sortie

- Le renderer est remplaçable derrière une interface stable.
- Le rendu n'est pas une source d'état de gameplay.
- Les scènes de référence respectent leurs budgets sur mobile.
- Clavier, tactile et accessibilité restent fonctionnels.
- Les masques d'occlusion arbitraires et les couches sont éditables dans le Studio.

---

## 8. v4.1.12 — Language

### 8.1 Objectif

Faire évoluer le DSL à partir des besoins réellement rencontrés par Gateways et Viewport, puis figer le langage comme
candidat 4.2.

### 8.2 Principes

- Une primitive exprime une intention de jeu, pas une API du renderer.
- Toute mutation d'état est visible du validateur et du solveur.
- Les identifiants stables sont obligatoires.
- Les extensions personnalisées restent du code de confiance.
- Les contenus sont compilés vers une représentation intermédiaire unique.

```text
GameSource
    ↓ validation et normalisation
CompiledGame
    ↓ compilation
GameIR
    ├── Runtime
    ├── Solver
    ├── Replay
    ├── Studio
    └── Documentation
```

### 8.3 Primitives candidates

Mise en scène :

- layers conditionnels ;
- caméra et focus ;
- timelines et keyframes ;
- zones, portails, occlusion et effets ;
- séquences interruptibles ;
- synchronisation facultative sur une cue audio.

Reality :

- attente d'un signal ;
- délai et expiration ;
- corrélation ;
- consommation unique ;
- capability requise ;
- fallback hors ligne ;
- résultat indéterminé ;
- consentement du joueur.

Narration :

- objectifs et sous-objectifs ;
- journal de quêtes ;
- états de dialogue nommés ;
- séquences parallèles ;
- rendez-vous temporels ;
- événements reliés au monde réel.

Chaque candidate doit prouver qu'une combinaison raisonnable des primitives existantes ne suffit pas avant son
admission.

### 8.4 Studio et outils

- Formulaires structurés générés depuis le schéma.
- Création et renommage sûre des identifiants.
- Diff avant écriture et undo/redo.
- Visualisation de l'IR et de la provenance source.
- Messages d'erreur reliant fichier, identifiant et champ.
- Documentation générée depuis les types et métadonnées.

### 8.5 Critères de sortie

- Aucune primitive n'est ignorée par le solveur, le replay ou le validateur.
- Le Studio sait créer et modifier chaque primitive publique.
- Les migrations des contenus officiels sont automatisées.
- La documentation et les exemples sont générés ou testés contre le schéma.
- Les sémantiques de base du DSL et de l'IR sont gelées ; un point d'extension identifié est réservé au manifeste de
  variance de v4.1.15. Le gel final candidat v4.2 intervient après Remix.

---

## 9. v4.1.13 — Proof at Scale

### 9.1 Objectif honnête

Une résolution générale sans explosion combinatoire ne peut pas être promise : la distribution des personnages et
des objets produit intrinsèquement un espace exponentiel. La promesse de v4.1.13 est donc :

> Prouver exhaustivement une classe documentée de jeux ouverts à trois personnages dans des budgets publiés, ou
> expliquer précisément pourquoi la preuve est incomplète.

### 9.2 Profil d'explosion

Attribuer le nombre d'états aux dimensions suivantes :

- positions des personnages ;
- distributions d'inventaire ;
- flags et compteurs ;
- dialogues ;
- scripts et événements ;
- symétries ;
- actions sans effet ;
- permutations d'actions indépendantes.

Le rapport doit montrer ce qui a grossi, ce qui a été abstrait et pourquoi une optimisation est active ou désactivée.

### 9.3 Représentation compacte

- Bitsets pour flags, inventaires et états finis.
- Interning et hash incrémental.
- Transitions compactes.
- Parents et témoins compressés.
- Stockage disque optionnel.
- Checkpoint et reprise d'une preuve interrompue.

### 9.4 Dominance et symétries

- Dominance d'inventaires et ressources monotones.
- Normalisation des personnages ou objets réellement équivalents.
- Décomposition des sous-puzzles indépendants.
- Frontières d'objectifs et de chapitres.
- Planification hiérarchique.

Chaque règle d'abstraction ou de dominance est comparée à l'exploration exhaustive sur des petits jeux générés. Une
optimisation qui change un verdict reste désactivée en mode preuve.

### 9.5 Backend symbolique

Évaluer par benchmark réel :

- BDD ;
- SAT/SMT ;
- model checking explicite ;
- recherche bidirectionnelle ;
- abstraction CEGAR.

Un backend n'est conservé que s'il améliore une classe de jeux représentative tout en restituant un témoin lisible.

### 9.6 Parallélisme

Après partitionnement de l'espace :

- partition par hash d'état ;
- work stealing ;
- table de visites partagée ou distribuée ;
- partage des bornes ;
- checkpoint coordonné ;
- résultat déterministe indépendamment du nombre de workers.

Les workers accélèrent une exploration ; ils ne sont pas présentés comme une solution à l'explosion combinatoire.

### 9.7 Matrice de référence

Définir avant l'implémentation une famille comprenant :

- 20 à 40 salles ;
- trois personnages ;
- objets transférables ;
- puzzles croisés ;
- dialogues, scripts et événements ;
- actions destructrices et vrais softlocks ;
- variantes ouvertes et contraintes.

### 9.8 Critères de sortie

- Les petites variantes donnent exactement le verdict de l'exhaustif de référence.
- La matrice annoncée termine sous les budgets publiés.
- Chaque softlock possède un chemin minimal reproductible.
- Le profil expose toutes les abstractions actives.
- Une limite produit `truncated`, jamais `proved`.
- Une recherche interrompue peut reprendre.
- Le même verdict est obtenu avec un ou plusieurs workers.

---

## 10. v4.1.14 — Time Attack

### 10.1 Objectif

Fournir un mode speedrun natif et vérifiable : catégories, chronomètres, splits, records personnels, ghosts, replay,
LiveSplit, OBS et classement facultatif. Le système distingue clairement un run local, reproductible, observé par le
serveur ou validé humainement.

Il ne promet pas une détection universelle de la triche.

### 10.2 Manifeste speedrun

```ts
interface SpeedrunManifest {
  categories: readonly SpeedrunCategory[];
  splits: readonly SpeedrunSplit[];
  rulesVersion: number;
}

interface SpeedrunCategory {
  id: string;
  name: string;
  timing: 'rta' | 'igt' | 'active-igt';
  start: SpeedrunTrigger;
  finish: SpeedrunTrigger;
  allowSaves: boolean;
  allowPauses: boolean;
  allowHints: boolean;
  realityPolicy: 'forbidden' | 'recorded' | 'live';
}
```

Catégories de référence : Any%, 100%, Glitchless, No Save/Load, No Hints, Random Seed, Reality Recorded et Reality
Live. Les règles sont versionnées ; une modification ne requalifie jamais silencieusement un ancien run.

### 10.3 Temps

Enregistrer simultanément :

- **RTA** : horloge monotone entre départ et fin ;
- **IGT** : temps logique reproductible depuis le replay ;
- **Active IGT** : temps pendant lequel le joueur peut agir selon les règles de la catégorie.

Les pauses, chargements, menus, cinématiques et passages en arrière-plan ont une politique explicite. L'horloge système
modifiable n'est jamais une autorité.

### 10.4 Splits sémantiques

Les splits reposent sur des événements du moteur : entrée dans une salle, objet acquis, objectif terminé, flag,
événement ou fin atteinte. Aucune reconnaissance de pixels n'est nécessaire.

Fonctions :

- splits et sous-splits automatiques ;
- meilleur segment et somme des meilleurs ;
- avance/retard contre un PB ;
- split manqué sans corruption de la tentative ;
- routes importables et exportables ;
- éditeur et prévisualisation dans le Studio.

### 10.5 Paquet de preuve

```ts
interface SpeedrunEnvelope {
  format: 'web-scumm-speedrun';
  schema: 1;
  gameId: string;
  gameHash: string;
  engineVersion: string;
  categoryId: string;
  rulesVersion: number;
  seed?: string;
  timing: SpeedrunTiming;
  splits: readonly RecordedSplit[];
  replay: readonly SessionEntry[];
  realitySignals?: readonly RecordedRealitySignal[];
  finalStateHash: string;
}
```

Le paquet conserve aussi les sauvegardes/chargements, indices, menus, méthode d'entrée et événements Reality pertinents.

### 10.6 Vérificateur headless

```text
npm run speedrun:verify -- run.wsrun
```

Le vérificateur contrôle l'enveloppe, recharge les règles exactes, rejoue les actions, recalcule l'IGT, vérifie les
restrictions et compare l'état final.

Verdicts : `valid`, `valid-unranked`, `invalid-category-rule`, `invalid-replay`, `modified-game`,
`missing-reality-proof`, `unsupported-version` et `inconclusive`. `Inconclusive` n'est jamais traité comme valide.

### 10.7 Reality et compétition

- `forbidden` : aucun événement externe ; catégorie déterministe.
- `recorded` : scénario signé et reproductible.
- `live` : événement réellement reçu ; catégorie séparée car latence et disponibilité ne sont pas reproductibles.

Les signaux conservent signature, séquence, horodatage Bridge, connecteur, hash et verdict de vérification.

### 10.8 Records, ghosts et solveur

- Historique local, PB, meilleurs segments, abandons et notes de route.
- Ghost affichant curseur, salle, action, avance/retard et progression d'inventaire.
- Ghost désactivable pour ne pas révéler les puzzles.
- Import d'un témoin du solveur comme « route logique », jamais présenté comme record humain.
- Comparaison de deux routes par actions, états et splits.

### 10.9 Streaming et classements

- Overlay complet, compact ou transparent.
- Browser Source OBS.
- Export LiveSplit et autosplit via WebSocket local.
- Aucun secret ou contenu personnel dans l'overlay.
- Classements optionnels sur le Bridge multi-tenant.

Niveaux de confiance : local, soumis, replay vérifié, observé par le serveur et validé par un modérateur. Le serveur
rejoue le run ; il ne fait jamais confiance au verdict du client.

### 10.10 Accessibilité et équité

Les catégories déclarent leurs règles pour souris, tactile, clavier, manette, commandes accessibles, macros, vitesse
du texte et réduction des animations. Une option d'accessibilité n'est jamais considérée implicitement comme une
triche.

### 10.11 Validation

- Même replay, même état final et même IGT sur Chromium, WebKit et Firefox.
- Framerate, renderer et vitesse de machine n'affectent pas le verdict logique.
- Rejet des temps, actions, seeds, règles, signaux ou hashes altérés.
- Reprise après fermeture d'onglet, veille, perte réseau et crash pendant l'écriture.
- Test terrain par au moins trois speedrunners externes.

### 10.12 Critères de sortie

- Une catégorie complète est définie sans modifier le moteur.
- RTA, IGT et Active IGT sont enregistrés.
- Les splits sont automatiques et reproductibles.
- Un run altéré est rejeté avec une raison précise.
- Les politiques Reality sont distinctes et vérifiables.
- LiveSplit et OBS fonctionnent à partir du build distribué.
- Les records locaux fonctionnent hors ligne.
- Le classement ne fait jamais confiance au seul client.
- Une tentative complète et son paquet de preuve sont publiés.

---

## 11. v4.1.15 — Remix

### 11.1 Objectif

Permettre à un même jeu de produire plusieurs parties réellement différentes sans transformer son histoire en contenu
aléatoire incohérent. Les variations sont déclarées par l'auteur, contraintes, déterministes à partir d'une seed et
comprises par le validateur, le solveur, les sauvegardes, le replay, le Studio et Time Attack.

Exemples visés :

- un objet utile parmi plusieurs emplacements autorisés ;
- un personnage présent dans une autre salle ou suivant un autre trajet ;
- un indice et sa solution associés différemment ;
- plusieurs ordres valides de groupes d'énigmes ;
- codes, ingrédients ou réponses tirés dans un ensemble contrôlé ;
- variantes de dialogues, de décor ou de paramètres de minijeu ;
- seed quotidienne identique pour tous les joueurs.

Remix n'est pas un générateur d'histoire par IA au runtime. Il ne mélange jamais arbitrairement les règles, les textes
ou les dépendances d'un puzzle.

### 11.2 Principe : une instance de monde déterministe

Au démarrage d'une nouvelle partie, le moteur compile le jeu et son manifeste de variance en une instance immuable :

```text
GameIR + VariationManifest + seed + algorithmVersion
                         ↓
                    WorldVariant
                         ↓
          Runtime · Solver · Replay · Speedrun
```

La même combinaison jeu, manifeste, version d'algorithme et seed produit exactement le même `WorldVariant` sur tous
les navigateurs supportés. Aucun appel à `Math.random()` n'est autorisé dans ce chemin.

### 11.3 Manifeste de variance

Contrat illustratif à finaliser par ADR :

```ts
interface VariationManifest {
  schema: 1;
  algorithm: 'web-scumm-remix-1';
  modes: readonly VariationMode[];
  dimensions: readonly VariationDimension[];
  constraints: readonly VariationConstraint[];
}

interface WorldVariant {
  seed: string;
  algorithm: string;
  manifestHash: string;
  assignments: Readonly<Record<string, unknown>>;
  hash: string;
}
```

Chaque dimension possède :

- un identifiant stable ;
- un domaine fini ou un générateur borné ;
- ses emplacements ou valeurs autorisés ;
- ses prérequis et exclusions ;
- ses liens avec d'autres dimensions ;
- son importance logique ou purement cosmétique ;
- une valeur fixe utilisée dans le mode histoire classique.

### 11.4 Variations natives

#### Placement d'objets

- Un objet peut choisir un point d'ancrage parmi une liste taguée.
- L'ancrage déclare visibilité, accessibilité, capacité et phase narrative.
- Deux objets ne peuvent occuper le même emplacement sauf autorisation explicite.
- Un objet requis ne peut être placé derrière une action qui le requiert déjà.

#### Position et emploi du temps des personnages

- Salle de départ variable.
- Route ou planning choisi parmi des variantes déclarées.
- Disponibilité garantie aux étapes nécessaires.
- Dialogues et animations compatibles avec chaque emplacement.

#### Indices, réponses et combinaisons

- Un indice et sa solution forment une affectation couplée.
- Modifier un code modifie automatiquement toutes ses occurrences et traductions structurées.
- Un indice ne peut désigner une valeur différente de celle acceptée par la solution.

#### Ordre des énigmes

L'auteur déclare des groupes d'énigmes et un graphe de dépendances. Remix peut choisir une topologie, activer des
branches facultatives ou permuter des groupes indépendants. Il ne réordonne jamais directement le tableau des règles,
car leur priorité peut porter une sémantique.

#### Variance de présentation

- Répliques alternatives de même intention.
- Props, ambiance, palette ou accessoires cosmétiques.
- Paramètres bornés d'un minijeu.
- Variantes sans effet logique classées séparément pour ne pas gonfler le solveur.

### 11.5 Contraintes et solvabilité

Le générateur privilégie une construction correcte plutôt qu'une boucle « tirer puis rejeter » :

- domaines et contraintes sont compilés avant le lancement ;
- les dépendances impossibles sont signalées au build ;
- les affectations couplées sont atomiques ;
- les ressources consommables et chemins obligatoires sont vérifiés ;
- les emplacements respectent navigation, visibilité et personnages capables d'y accéder ;
- une seed invalide produit une erreur explicite, jamais un fallback silencieux vers un autre monde.

Deux stratégies sont admises :

1. **Catalogue fini** : toutes les instances sont générées et prouvées avant publication.
2. **Générateur par construction** : les invariants du générateur sont testés exhaustivement sur de petits domaines,
   par propriétés sur de grands domaines et par preuve d'un échantillon publié de seeds.

Le projet doit annoncer clairement laquelle des deux stratégies soutient chaque mode. Il ne peut pas prétendre que
toutes les seeds sont prouvées si seules certaines ont été échantillonnées.

### 11.6 PRNG et stabilité

- Choisir un PRNG déterministe, documenté et indépendant du navigateur.
- Versionner son algorithme.
- Séparer les flux logiques, cosmétiques et minijeux afin qu'ajouter un détail visuel ne déplace pas tous les tirages.
- Dériver chaque flux de la seed et de l'identifiant stable de la dimension.
- Enregistrer affectations et trace de tirages dans les outils de diagnostic.
- Ne jamais régénérer une ancienne sauvegarde avec une nouvelle version d'algorithme.

Une sauvegarde conserve le `WorldVariant` effectivement utilisé. La seed seule sert au partage ; elle ne remplace pas
l'affectation persistée lorsqu'une version ancienne est chargée.

### 11.7 Validation et preuve

Ajouter :

```text
npm run remix -- --seed <seed>
npm run remix -- --preview <seed>
npm run verify:variants
```

Les outils doivent :

- valider domaines, contraintes, ancres et identifiants ;
- générer une instance lisible et son hash ;
- exécuter `validate`, témoin et preuve sur cette instance ;
- comparer la génération entre Node, Chromium, WebKit et Firefox ;
- détecter les valeurs jamais choisies et les emplacements injustement dominants ;
- produire une couverture par dimension et par couple de dimensions ;
- conserver les certificats de preuve par hash d'instance.

Pour un catalogue fini, chaque instance est un gate de release. Pour un espace non borné pratiquement, la release
publie les invariants de construction, la stratégie d'échantillonnage, les seeds limites et le nombre de seeds testées.

### 11.8 Sauvegardes, replay et Time Attack

Les éléments suivants deviennent obligatoires dans une partie Remix :

- seed affichable et partageable ;
- version du PRNG ;
- hash du manifeste ;
- affectations générées ;
- hash de l'instance ;
- tirages logiques enregistrés dans le replay.

Catégories de speedrun :

- **Fixed Seed** : seed publiée et entraînable ;
- **Random Seed** : seed tirée au départ et révélée immédiatement ;
- **Mystery Seed** : seed engagée cryptographiquement puis révélée après le départ ;
- **Daily Seed** : seed et règles signées par le Bridge ;
- **Story** : aucune variation logique.

Les classements séparent seed fixe et seed aléatoire. Un record RTA entre deux seeds différentes n'est comparable que
si la catégorie le prévoit explicitement.

### 11.9 Studio

Ajouter une vue Remix permettant de :

- créer les dimensions et contraintes ;
- sélectionner des ancres depuis la scène ;
- prévisualiser une seed ;
- verrouiller certaines dimensions et en relancer d'autres ;
- comparer deux instances ;
- afficher le graphe d'énigmes résultant ;
- voir couverture, fréquence et biais de chaque valeur ;
- rejouer directement une seed dans le Studio ;
- exporter une instance figée pour un bug ou un playtest.

Le Studio signale notamment une ancre inaccessible, une combinaison jamais produite, un indice non couplé et une
dimension logique absente du solveur.

### 11.10 Expérience du joueur

Le menu Nouvelle partie peut proposer :

- **Histoire** : monde canonique conçu par l'auteur ;
- **Remix** : seed aléatoire locale ;
- **Seed personnalisée** : saisie ou partage d'un code ;
- **Défi quotidien** : seed publiée par le Bridge ;
- **Réglages avancés** : uniquement si le jeu les autorise.

Le joueur peut copier le code de sa partie. Les éléments susceptibles de révéler la solution restent masqués jusqu'à
la fin si le mode le demande. Les options d'accessibilité ne modifient pas implicitement la seed ou la validité d'une
catégorie.

### 11.11 Reality, sécurité et confidentialité

- Un événement Reality n'est pas utilisé comme source aléatoire implicite.
- Les défis quotidiens utilisent un engagement signé puis une révélation vérifiable lorsque la seed doit rester secrète.
- Le Bridge ne choisit pas une seed après avoir observé les actions d'un joueur.
- Une seed n'est pas un secret d'authentification.
- Les codes partagés ne contiennent ni identifiant de joueur ni donnée personnelle.
- Le mode hors ligne peut vérifier une seed déjà signée.

### 11.12 Critères de sortie

- Même seed, même instance et même hash sur Node, Chromium, WebKit et Firefox.
- Une ancienne sauvegarde recharge son affectation exacte après évolution du générateur.
- Aucun chemin logique n'utilise `Math.random()`.
- Objets, personnages, indices et ordre de groupes d'énigmes possèdent chacun une fixture réelle.
- Chaque instance du catalogue fini est validée et prouvée.
- Les générateurs ouverts publient honnêtement leur couverture et leurs limites de preuve.
- Un indice et sa solution ne peuvent jamais être désynchronisés.
- Replay et paquet speedrun reproduisent exactement le même monde.
- Le Studio prévisualise, compare et exporte une seed.
- Le jeu de référence fournit un mode histoire, un mode Remix et un défi quotidien reproductible.
- Au moins vingt seeds de playtest sont exécutées automatiquement et cinq sont jouées par des humains.

---

## 12. Dépendances entre versions

```text
4.1.8 Foundation Reset
   └── 4.1.9 Gateways
         └── 4.1.10 Constellation

4.1.8 Foundation Reset
   └── 4.1.11 Viewport
         └── 4.1.12 Language
               └── 4.1.13 Proof at Scale
                     └── 4.1.14 Time Attack
                           └── 4.1.15 Remix

4.1.10 Constellation ─────────────────────┘
```

Le développement de Viewport peut commencer en parallèle de Gateways après la 4.1.8, mais Language ne doit être figé
qu'après le retour des deux branches. Time Attack dépend du DSL de base, du replay, du solveur et du Bridge distribué.
Remix dépend à son tour du PRNG, du paquet de preuve et des catégories seedées introduites par Time Attack. Le gel final
du DSL et de l'IR intervient après v4.1.15.

## 13. Ce qui reste hors de la ligne 4.1

- Plateforme commerciale hébergée et facturation.
- Récompenses financières de speedrun.
- Détection universelle de la triche.
- Physique générale.
- 3D.
- Cloud saves multi-appareils grand public.
- Matchmaking et courses synchronisées en temps réel.
- Histoire ou dialogues générés dynamiquement par une IA au runtime.
- Placement procédural sans contraintes ni preuve de solvabilité.
- Compatibilité éternelle avec les formats expérimentaux 4.1.x.

Ces éléments nécessitent un besoin réel après stabilisation du premier jeu.

## 14. Passage à la v4.2

La v4.2 est déclarée stable seulement lorsque :

- le DSL, l'IR, les sauvegardes et les interfaces de plugins sont figés ;
- les packages sont compilés, minimaux et installables depuis un registre ou des archives autonomes ;
- le Reality Bridge possède un profil local et un profil distribué documentés ;
- au moins un connecteur réel est exploité dans un chapitre de référence ;
- le renderer retenu fonctionne sur les navigateurs et appareils annoncés ;
- la matrice à trois personnages termine dans ses budgets publiés ;
- le replay et le vérificateur speedrun donnent le même verdict sur tous les navigateurs supportés ;
- une seed Remix produit la même instance sur tous les runtimes supportés ;
- les modes à catalogue fini sont entièrement prouvés et les modes génératifs publient leurs limites de couverture ;
- les passages Android, iPhone/Safari, Windows et lecteur d'écran ont été réalisés par des humains ;
- un jeu réel de 30 à 45 minutes éprouve toute la chaîne ;
- SemVer redevient strict : ajout en mineure, rupture à la prochaine majeure.

## 15. Mode d'exécution recommandé pour un agent

Pour chaque version :

1. ouvrir une branche dédiée depuis le tag précédent ;
2. lire `AGENTS.md`, le dernier `docs/dev/LOG.md` et les ADR concernées ;
3. reproduire et mesurer avant de modifier ;
4. proposer l'ADR et les contrats avant l'implémentation transversale ;
5. livrer par petits lots indépendamment testables ;
6. exécuter `quality`, tests unitaires, tests lourds pertinents, preuves et E2E du build ;
7. vérifier les archives dans un dossier extérieur au dépôt ;
8. publier les résultats bruts, écarts de baseline et limites restantes ;
9. faire relire le changement par un autre agent ou un humain ;
10. ne taguer qu'après CI verte sur le commit exact du tag.

La réussite du programme n'est pas le nombre de fonctionnalités ajoutées. Elle se mesure à la capacité d'un humain,
d'un agent, du runtime et du solveur à donner la même réponse sur ce que le jeu peut faire et sur ce qui s'est
réellement produit.
