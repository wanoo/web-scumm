# web-scumm 4.1 — Reality Bridge

> **Statut : proposition d'architecture, pas engagement de release.**  
> Branche : `feature/4.1-reality-bridge`  
> Base : web-scumm 4.0 « Stable Platform »  
> Nom de travail : **4.1 “Signals”**

## 1. Intention

La 4.1 doit permettre à un jeu web-scumm de réagir à un fait provenant du monde extérieur — webhook, email, terminal,
credential, objet physique — sans donner au contenu du jeu un accès réseau arbitraire et sans perdre les propriétés qui
font la valeur du moteur : état sérialisable, replay déterministe, solveur honnête, fonctionnement hors ligne et jeu
décrit par des données.

La 4.1 ne livre pas encore un serveur SMTP, SSH ou Telnet complet. Elle livre le **protocole commun** qui permettra à ces
connecteurs d'arriver ensuite sans créer un mécanisme différent pour chacun :

```text
monde extérieur        code de confiance              cœur déterministe

email ───────┐
webhook ─────┤      ┌──────────────────┐      ┌──────────────────────┐
badge ───────┼─────▶│  Reality Bridge  │─────▶│  WorldSignalPort     │
SSH/Telnet ──┤      │ auth · validation│      │ session · save · emit│
QR/NFC ──────┘      │ log · signature  │      └──────────────────────┘
                    └──────────────────┘
```

Le jeu reçoit un petit signal typé et vérifié. Il ne reçoit ni socket, ni clé, ni email brut, ni fonction exécutable.

## 2. Résultat attendu de la 4.1

Un auteur doit pouvoir déclarer :

```ts
reality: {
  signals: [
    {
      id: 'mail.answer.correct',
      source: 'mail',
      availability: 'optional',
      replay: 'record',
    },
  ],
},
events: [
  {
    id: 'mail-opens-vault',
    on: 'mail.answer.correct',
    once: true,
    do: [{ set: ['vault.remoteUnlocked', true] }],
  },
],
```

Le Studio permet d'injecter ce signal sans serveur. Le Bridge de référence peut le recevoir par un webhook signé. La
session exportée le rejoue sans réseau. Le solveur peut prouver le jeu avec ou sans ce signal. Une livraison répétée,
retardée ou dans le désordre ne rejoue jamais deux fois son effet.

## 3. Décisions d'architecture proposées

### 3.1 Le Bridge est séparé du moteur et de la PWA

- La PWA reste publiable comme site statique.
- Le Bridge est un service optionnel, déployé séparément.
- Aucun module serveur, parseur d'email, serveur SSH ou secret n'entre dans le bundle du joueur.
- Un jeu sans section `reality` ne charge aucun code supplémentaire.
- Les connecteurs sont du code de confiance. `games/<id>/` reste exclusivement déclaratif.
- Le Bridge ne peut pas écrire dans le dépôt, appeler le Studio, exécuter une commande système ou charger une sauvegarde.

### 3.2 Biscuit autorise ; la signature d'événement atteste

[Eclipse Biscuit](https://doc.biscuitsec.org/) sert aux capacités et à leur délégation :

- quel connecteur peut proposer un événement ;
- pour quel jeu et quel joueur ;
- pour quelle famille de signaux ;
- jusqu'à quelle date ;
- à quelle audience et dans quel environnement.

Le Bridge vérifie le Biscuit et sa politique Datalog avant d'accepter l'événement. Ensuite seulement, il attribue la
séquence canonique et signe l'enveloppe finale avec une clé d'événements séparée.

```text
Biscuit     = « cet adaptateur a le droit de demander mail.answer.* »
Ed25519     = « le Bridge a accepté exactement cet événement »
TLS / SSH   = protection du transport
journal     = ordre, déduplication, reprise et audit
```

Un Biscuit est un bearer token : sa possession suffit à exercer les droits qu'il contient. Les jetons doivent donc être
atténués, courts, révocables, bornés à une audience, un jeu, un joueur, une source et une liste de signaux. Aucun Biscuit
ne traverse Telnet ; un code Telnet à usage unique est échangé côté serveur contre une capacité interne.

La 4.1 doit réaliser un spike de compatibilité entre les implémentations JavaScript et Rust de Biscuit avant de figer le
format. Les vecteurs officiels du projet sont exécutés en CI. La version du format et l'identifiant de clé racine sont
enregistrés ; une version inconnue est refusée, jamais interprétée au mieux.

### 3.3 Sémantique de livraison : au moins une fois, effet au plus une fois

Un réseau ne garantit pas exactement une livraison. Le contrat honnête est :

- le Bridge conserve un journal ordonné et livre **au moins une fois** ;
- le moteur enregistre les identifiants appliqués et exécute leur effet **au plus une fois** ;
- le client sauvegarde durablement l'état avant d'accuser réception ;
- après un crash entre sauvegarde et accusé, le Bridge redélivre et le moteur reconnaît le doublon ;
- un curseur indique la dernière séquence contiguë, avec une petite liste des trous éventuels.

La 4.1 ne doit employer le terme « exactly once » ni dans le code ni dans la documentation.

### 3.4 Le moteur reçoit un alphabet fini, pas du texte hostile

La première version ne rend pas le payload extérieur accessible aux conditions ou commandes. L'adaptateur classe le
résultat dans un identifiant déclaré, par exemple :

```text
mail.answer.correct
mail.answer.wrong
badge.archivist.verified
badge.archivist.rejected
terminal.vault.opened
```

Les métadonnées minimales peuvent apparaître dans le journal de diagnostic, mais ne deviennent pas automatiquement des
flags, des lignes de dialogue ou du HTML. Cette contrainte :

- empêche l'injection de contenu ;
- protège les données personnelles ;
- garde le solveur dans un espace fini ;
- évite d'inscrire des emails complets dans une sauvegarde ou un rapport de bug.

Les projections de données typées pourront être proposées en 4.2 après un audit de ce premier contrat.

## 4. Contrats proposés

### 4.1 Enveloppe canonique

```ts
interface WorldSignalV1 {
  format: 'web-scumm-world-signal';
  schema: 1;
  id: string;
  sequence: number;
  gameId: string;
  playerId: string;
  signal: string;
  source: string;
  occurredAt?: number;
  receivedAt: number;
  expiresAt?: number;
  dedupeKey: string;
  policyVersion: string;
  evidenceHash?: string;
}

interface SignedWorldSignalV1 {
  payload: string; // octets exacts encodés en base64url, pas un objet re-sérialisé
  signature: {
    algorithm: 'Ed25519';
    keyId: string;
    value: string;
  };
}
```

La signature porte sur les octets transportés. Le client vérifie avant de décoder et valider le schéma. Cette forme
évite qu'une sérialisation JSON différente produise une ambiguïté. Le choix final entre une enveloppe JWS et COSE doit
être mesuré sous Chromium et WebKit ; le contrat public ne doit pas exposer la bibliothèque retenue.

### 4.2 Port du joueur

```ts
interface WorldSignalPort {
  connect(input: {
    gameId: string;
    playerId: string;
    after: number;
    signal?: AbortSignal;
  }): AsyncIterable<SignedWorldSignalV1>;

  acknowledge(input: {
    playerId: string;
    through: number;
  }): Promise<void>;

  close(): Promise<void>;
}
```

Le transport de référence utilise HTTPS et SSE ou WebSocket sécurisé, avec reprise par curseur. Une implémentation par
polling doit donner exactement les mêmes événements. Le port est injecté comme les stores : le moteur ne connaît pas le
réseau.

### 4.3 État sauvegardé

Ajouter un champ optionnel et complété au chargement, sans changer l'enveloppe de sauvegarde schema 3 :

```ts
interface RealityState {
  playerId?: string;
  cursor: number;
  applied: Record<string, 1>;
}
```

`applied` doit être borné et compacté quand le curseur prouve que les événements antérieurs ne seront plus redélivrés.
Le format exact de cette compaction doit être couvert par un test de sauvegarde avant d'être public.

### 4.4 Session et replay

Une entrée extérieure devient une véritable entrée de session :

```ts
type ExternalSessionEntry = {
  external: {
    id: string;
    sequence: number;
    signal: string;
    source: string;
    receivedAt: number;
    evidenceHash?: string;
  };
};
```

Le replay applique cette entrée locale et ne contacte jamais le Bridge. Il ne contient ni Biscuit, ni adresse email, ni
credential, ni donnée brute du connecteur. Le digest d'état continue à repérer la première divergence.

### 4.5 Manifeste public du jeu

`compileGame` produit un manifeste sans secret :

```json
{
  "format": "web-scumm-reality-manifest",
  "schema": 1,
  "gameId": "demo",
  "signals": [
    {
      "id": "mail.answer.correct",
      "source": "mail",
      "availability": "optional",
      "replay": "record"
    }
  ]
}
```

Le Bridge refuse tout signal absent de ce manifeste. Un hash du manifeste accompagne sa configuration déployée afin
qu'une ancienne configuration ne puisse pas publier un identifiant supprimé ou renommé.

## 5. Identité et appairage

La 4.1 ne crée pas de compte web-scumm global. Elle introduit une identité pseudonyme liée à une partie :

1. la PWA demande une session d'appairage au Bridge ;
2. le Bridge retourne un code court ou un QR temporaire ;
3. le joueur confirme la liaison ;
4. le Bridge attribue un `playerId` opaque ;
5. la sauvegarde conserve ce `playerId` et un jeton client fortement limité à `read` et `ack` ;
6. l'écran Reality permet de suspendre ou révoquer la liaison.

Le jeton d'administration, la clé Biscuit racine et la clé de signature des événements ne sont jamais envoyés au
navigateur. Le stockage navigateur de la capacité client doit être documenté comme sensible et testé après effacement,
expiration et révocation.

## 6. Solveur et disponibilité extérieure

Une fin ne doit pas être déclarée prouvée en supposant silencieusement que le monde extérieur coopérera.

Ajouter trois politiques au solveur :

- `closed`: aucun signal extérieur ; comportement par défaut ;
- `scenario`: injection d'une suite de signaux déclarée par une fixture ;
- `adversarial`: absences, doublons et ordres autorisés explorés sur un petit alphabet borné.

Chaque signal déclare :

- `availability: 'optional' | 'required'` ;
- s'il participe à la fin principale ;
- une fixture de preuve s'il est requis ;
- un fallback narratif ou manuel si le service est indisponible ;
- une politique `once` ou répétable.

`verify:game` échoue en release si :

- un signal requis n'a ni scénario ni fallback ;
- un signal non déclaré est écouté comme signal extérieur ;
- le scénario est tronqué ;
- l'absence ou le doublon crée un softlock non déclaré ;
- un signal possède un espace de variantes non borné.

Le rapport doit distinguer : « fin prouvée sans monde extérieur », « fin prouvée sous scénario X » et « intégration
simulée seulement ». Une preuve ne contacte jamais un vrai service.

## 7. Reality Bridge de référence

La 4.1 livre un service minimal utilisable en local et auto-hébergeable :

- endpoint d'appairage ;
- endpoint interne `propose signal` protégé par Biscuit ;
- endpoint webhook de démonstration protégé par signature ou secret dédié ;
- vérification Datalog, manifeste et schéma ;
- journal persistant de référence ;
- séquence par joueur ;
- déduplication ;
- signature des événements ;
- flux SSE ou WebSocket et récupération HTTP par curseur ;
- accusés de réception ;
- rotation de clés avec période de recouvrement ;
- révocation des joueurs et connecteurs ;
- quotas et limites de taille ;
- logs structurés sans secret ni contenu personnel.

Le stockage est derrière une interface. Les tests utilisent la mémoire ; le serveur de référence fournit un stockage
local simple. Une base distribuée, un service hébergé multitenant, une facturation et une haute disponibilité ne font pas
partie de la 4.1.

## 8. Studio et expérience auteur

Ajouter un panneau **Reality** au Studio :

- état de la liaison ;
- manifeste des signaux ;
- historique local expurgé ;
- bouton d'injection pour chaque signal ;
- simulation d'une livraison retardée ;
- duplication du dernier événement ;
- ordre inversé ;
- mauvaise signature ;
- expiration ;
- coupure et reprise du Bridge ;
- export de la session résultante.

Le simulateur utilise le même chemin d'application que le vrai port après la vérification cryptographique. Il ne doit
pas appeler directement `Engine.emit()` depuis l'interface, sinon il ne teste ni session, ni sauvegarde, ni déduplication.

Le MCP expose uniquement les opérations de simulation en développement. Il ne retourne jamais un token et ne permet pas
d'appeler un Bridge de production.

## 9. Menaces couvertes

Un `THREAT-MODEL.md` accompagne l'implémentation. Au minimum :

| Menace | Réponse attendue |
|---|---|
| adaptateur compromis | Biscuit atténué à un jeu, joueur, signal, audience et temps |
| vol d'un bearer token | expiration courte, révocation, rotation, TLS, droits minimaux |
| signal modifié | signature finale et validation avant décodage |
| rejeu réseau | `id`, `sequence`, `dedupeKey`, état `applied` |
| événement pour un autre joueur | correspondance `gameId` + `playerId` imposée par politique et client |
| ancien manifeste | hash du manifeste dans la configuration du Bridge |
| saturation | quotas par source et joueur, payload et file bornés, délais |
| fuite dans une session | aucune donnée brute ni token dans les sauvegardes et exports |
| XSS du jeu | capacité client minimale et révocable ; aucune capacité d'émission ou d'administration |
| panne du Bridge | file durable, reprise par curseur, fallback de gameplay |
| clé compromise | `keyId`, rotation documentée, révocation et horizon de rétention |

Biscuit ne remplace pas la vérification métier. Un adaptateur Open Badge devra toujours vérifier la preuve du credential,
sa période, son statut, l'émetteur accepté et le lien au titulaire. Biscuit dira seulement qui peut soumettre ou publier
le verdict.

## 10. Découpage de mise en œuvre

### Lot A — Spike et décisions irréversibles

- Prototyper Biscuit JS ↔ Rust avec les vecteurs officiels.
- Mesurer création, atténuation et vérification sur Node, Chromium et WebKit.
- Prototyper Ed25519/JWS et COSE dans les deux navigateurs.
- Décider du transport de référence et de la sérialisation signée.
- Rédiger le modèle de menace et les décisions de clés.

**Sortie :** aucune API publique ; rapport reproductible ; choix cryptographique justifié par mesures.

### Lot B — Protocole pur

- Types, schémas et fixtures `WorldSignalV1`.
- Vérification de signature et trousseau avec rotation.
- Manifeste généré par `compileGame`.
- Politiques Biscuit de référence et tests négatifs.
- Aucune dépendance serveur importable depuis le joueur.

**Sortie :** un corpus de conformité donne le même verdict dans toutes les implémentations retenues.

### Lot C — Moteur, sauvegarde et replay

- `WorldSignalPort` injectable.
- Application idempotente puis autosauvegarde durable puis accusé.
- `RealityState` borné et migrations par complétion.
- `ExternalSessionEntry`, export et replay hors ligne.
- Traces et messages d'erreur expurgés.

**Sortie :** crash à chaque frontière du protocole, recharge et redélivrance sans perte ni double effet.

### Lot D — Solveur et validation

- Déclaration des signaux dans le contenu.
- Modes `closed`, `scenario`, `adversarial`.
- Fixtures absence, doublon, ordre, expiration et fallback.
- Graphe de puzzle et couverture du storyboard informés des signaux.
- Statuts honnêtes dans CLI, JSON, Studio et MCP.

**Sortie :** aucun service externe appelé ; même verdict entre scénario rejoué par le moteur et scénario exploré.

### Lot E — Bridge et webhook de référence

- Appairage pseudonyme.
- Proposition interne autorisée par Biscuit.
- Journal, curseurs, déduplication, signatures et révocation.
- Transport vers le joueur.
- Webhook signé minimal transformé en signal fini.
- Configuration de développement sans secret commité.

**Sortie :** un processus Bridge neuf peut être lancé par `doctor`, testé puis supprimé sans modifier le jeu.

### Lot F — Studio, navigateurs et documentation

- Panneau Reality et simulateur de défaillances.
- E2E du build de production sous Chromium et WebKit.
- Documentation auteur en anglais et français.
- API publique et politique de compatibilité mises à jour.
- Guide d'exploitation, rotation, révocation, sauvegarde et suppression des données.
- Jeu d'exemple utilisant uniquement le webhook local, jamais un service tiers en CI.

**Sortie :** release-check verte, archive sans secret, licence et SBOM du Bridge incluses.

## 11. Matrice de tests minimale

### Protocole

- enveloppe valide ; octet modifié ; mauvaise clé ; clé expirée ; algorithme inconnu ; schéma futur ; payload trop grand ;
- Biscuit valide ; expiré ; révoqué ; mauvaise audience ; mauvais jeu ; mauvais joueur ; source ou signal hors capacité ;
- compatibilité croisée des implémentations Biscuit retenues.

### Livraison

- en ligne ; hors ligne puis reprise ; événement dupliqué ; séquences inversées ; trou de séquence ; expiration ;
- crash avant application, après application, après sauvegarde et avant accusé ;
- reconnexion depuis une vieille sauvegarde ; deux onglets ouverts sur la même partie ;
- révocation pendant une connexion active.

### Moteur

- listener `once` et répétable ; script bloqué sur `waitEvent` ; changement de salle pendant la livraison ;
- cinématique, dialogue ou minijeu actif au moment du signal ;
- save/load, export/import et replay sans Bridge ;
- traduction sans incidence sur les identifiants.

### Preuve

- jeu finissable sans signal ; finissable sous scénario ; softlock si signal absent ; fallback ;
- doublon sans nouvel effet ; deux signaux dont l'ordre change le verdict ; scénario tronqué signalé comme tel.

### Navigateur et accessibilité

- Chromium et WebKit, téléphone et clavier ;
- statut de connexion annoncé sans interrompre un dialogue ;
- panneau utilisable au clavier et au lecteur d'écran ;
- reconnexion PWA après démarrage hors ligne.

## 12. Budgets et compatibilité

- **Jeu sans Reality Bridge :** zéro requête, zéro code client Reality dans le chunk initial, aucune différence d'état.
- **Jeu avec Reality Bridge :** client chargé à la demande ; budget gzip défini après le spike et tenu par la CI.
- **Sauvegardes :** toute sauvegarde 3.x ou 4.0 reste chargeable ; aucune rupture de l'enveloppe schema 3.
- **Contenu :** `reality` est optionnel et additif ; aucune migration requise pour un jeu 4.0.
- **API :** nouveau point d'entrée public additif, conformément à SemVer ; aucun chemin interne documenté comme stable.
- **File :** limites configurables et valeurs sûres par défaut ; le dépassement est visible, jamais supprimé silencieusement.
- **Données :** rétention documentée ; export et suppression par `playerId` ; aucun secret dans les logs.

Les nombres de latence et de taille seront fixés par le lot A sur les machines et navigateurs déjà utilisés par le
projet. Ils ne doivent pas être inventés avant la mesure.

## 13. Critères de sortie 4.1

La 4.1 ne peut pas être publiée tant que :

1. un signal modifié, expiré ou destiné à un autre joueur peut atteindre `Engine.emit()` ;
2. un adaptateur peut émettre hors des droits de son Biscuit ;
3. un doublon peut répéter un effet de gameplay ;
4. un crash entre réception, sauvegarde et accusé peut perdre un événement ;
5. un replay nécessite le Bridge ou contient un token ;
6. le solveur considère implicitement un service extérieur disponible ;
7. un jeu 4.0 sans `reality` paie du code ou une requête supplémentaire ;
8. une sauvegarde antérieure ne charge plus ;
9. le Studio simule par un chemin différent de la production ;
10. le Bridge peut atteindre le Studio, le dépôt ou le système de fichiers du jeu ;
11. les politiques de rotation, révocation, rétention et suppression ne sont pas documentées ;
12. les tests de falsification et de reprise ne passent pas sous Chromium et WebKit.

La release doit démontrer, sur un exemple local, le parcours suivant : appairer une partie, couper le navigateur,
recevoir deux fois le même webhook, rouvrir la PWA hors ligne, se reconnecter, appliquer une seule fois le signal,
sauvegarder, exporter la session, arrêter le Bridge et rejouer la session jusqu'à la même fin.

## 14. Explicitement hors 4.1

- réception SMTP et envoi d'emails réels ;
- serveur SSH ou Telnet public ;
- vérificateur Open Badges/Verifiable Credentials complet ;
- SMS, messageries, calendrier, NFC, Bluetooth ou géolocalisation ;
- payload libre utilisable dans le DSL ;
- marketplace de connecteurs ;
- service multitenant hébergé par web-scumm ;
- promesse d'exactly-once distribuée ;
- effets sortants arbitraires déclenchés par une commande de jeu.

Ces intégrations deviennent des candidats 4.2+ une fois le protocole 4.1 éprouvé. L'ordre recommandé est : webhook,
email, credentials, SSH, puis Telnet expérimental.

## 15. Questions à trancher après le spike

1. JWS ou COSE pour l'enveloppe finale, au vu du poids et de WebKit ?
2. SSE avec récupération HTTP, WebSocket, ou les deux derrière le même port ?
3. Implémentation Biscuit unique en production ou vérification croisée Rust/JavaScript à chaque release ?
4. Stockage de référence local : SQLite ou adaptateur plus simple sans dépendance native ?
5. Durée et méthode de renouvellement de la capacité client persistante ?
6. Les signaux requis pour la fin sont-ils autorisés en release commerciale ou seulement avec un fallback prouvé ?
7. Le Bridge appartient-il au paquet principal, à un paquet optionnel ou à un dépôt séparé après la 4.1 ?

Ces questions ne doivent pas être résolues par intuition. Chaque décision reçoit un test, une mesure ou un scénario de
menace, puis une entrée dans `docs/dev/DECISIONS.md`.
