# Faire tourner un Reality Bridge

Le Bridge de référence (`bridge/src/`, le paquet `web-scumm-bridge`) sert un jeu. C'est un petit service Node :
appairage, connecteurs sous capacités Biscuit, un webhook de démonstration, un journal, des événements signés, des
Server-Sent Events. Pour les auteurs : `docs/fr/REALITY.md`. Pour le pourquoi : `docs/dev/THREAT-MODEL.md`.

## En lancer un

```sh
npm run bridge -- init [--dir=.cache/bridge] [--audience=bridge.example] [--origin=https://jeu.example]
npm run bridge -- serve [--dir=.cache/bridge] [--port=8787] [--host=127.0.0.1]
```

`init` lit le manifeste du jeu depuis son contenu et écrit, sous `--dir` en mode 600 :

- `config.json` : le manifeste et son empreinte, la clé publique racine Biscuit, la clé qui signe les événements
  (Ed25519, avec un `kid`), l'empreinte du jeton de l'opérateur, un webhook de démonstration par source (son secret,
  son propre jeton : tout joueur des signaux de cette source, peut confirmer des appairages, 30 jours ou
  `--demo-days`) ;
- `root.key` : la moitié privée de la racine Biscuit, lue par `grant` seulement (`serve` ne la charge jamais : la
  garder là où le Bridge n'est pas, si possible) ;
- `admin-token` : le jeton de l'opérateur, seule copie en clair.

Rien de secret n'est affiché ni commité (`.cache/` est ignoré). Dans un projet de jeu, la commande est `web-scumm bridge`.
Le paquet `web-scumm-bridge` (l'archive de la release) est un seul module JavaScript plus ses politiques Datalog : il
lui faut Node 22.12 ou plus, le WebAssembly de Biscuit et zod, rien d'autre, et `web-scumm-bridge` est sa commande.

Derrière HTTPS : lancer `serve` sur `127.0.0.1` derrière un proxy inverse qui termine TLS et ne met pas en tampon les
réponses `text/event-stream`, avec `--trust-proxy` pour que les limites par adresse voient celle du client
(`X-Forwarded-For`). `--origin` liste le site du jeu (CORS) ; les routes du joueur ne répondent qu'à lui. Mettre
l'URL publique dans `reality.bridge` du jeu. Sur Internet, `init --no-demo-webhooks` et un `grant` par connecteur,
chacun aussi étroit que sa tâche.

Par adresse, les routes que n'importe qui peut appeler (un code, son état, les clés, le manifeste) répondent à 60
requêtes par minute, et 60 authentifications ratées par minute sur les autres refusent un moment toute requête de
cette adresse (429, `Retry-After`). Les codes en attente de confirmation ne vivent qu'en mémoire, 1000 au plus tous
joueurs confondus : rien n'est écrit pour un code que personne ne confirme.

## Les connecteurs

Un connecteur propose des signaux avec un Biscuit émis depuis la clé racine :

```sh
npm run bridge -- grant --connector=mail-1 --source=mail --signals=mail.answer.correct,mail.answer.wrong \
  [--players=any|p-…,p-…] [--pair] [--days=30]
```

Il nomme le jeu, les sources, les signaux, les joueurs (ou tout joueur du jeu), l'audience du Bridge et une
expiration (à la seconde ; refusé dès cette seconde). `--pair` lui permet de confirmer des codes d'appairage. Un
connecteur peut atténuer son propre jeton (moins de joueurs, une expiration plus proche) avant de le transmettre ;
jamais l'élargir.

- `POST /v1/signals` (jeton Bearer) `{ playerId, signal, source, dedupeKey, occurredAt?, evidenceHash? }` : 202
  accepté, 200 déjà accepté (même `dedupeKey`), 403 non autorisé, 422 absent du manifeste, 429 au-delà d'un quota.
- `POST /v1/pairings/<code>/confirm` (jeton Bearer avec `--pair`) : lie le joueur qui montre ce code.
- `POST /v1/hooks/<source>` avec `X-Web-Scumm-Signature: sha256=<HMAC du corps>` `{ playerId, event, id }` : le
  webhook de démonstration ; `event` doit être connu, `id` nomme la livraison (déduplication).

Un connecteur vérifie ce qu'il affirme (la preuve d'un badge, l'expéditeur d'un email) : Biscuit dit seulement qui
peut proposer.

## Côté joueur

- `POST /v1/pairings` `{ gameId }` → `{ code, expiresAt }` (10 minutes) ; `GET /v1/pairings/<code>` → en attente,
  puis une seule fois `{ playerId, capability }`.
- `GET /v1/events?after=<n>` (SSE, capacité Bearer) et `GET /v1/signals?after=<n>` → `{ signals, sequences }` : les
  signaux signés après une séquence, chacun avec la sienne. `POST /v1/ack { through }` : appliqué et sauvegardé
  jusque-là. Un joueur tient au plus 4 flux ouverts ; un flux dont le lecteur ne lit plus (64 Ko non envoyés) ou dont
  le lien a été révoqué ou a expiré entre-temps est fermé par le Bridge, et le joueur se reconnecte depuis son curseur.
- `GET /v1/keys` : les clés publiques, actuelle et précédentes.

Une capacité lit et accuse réception des signaux d'un joueur, rien d'autre, et vit 30 jours depuis son dernier
accusé, 180 jours au plus depuis son appairage.
Dans le navigateur elle reste sensible (tout script de la page peut la lire) : révoquée ou expirée, le joueur devient
« délié » et le jeu peut se lier à nouveau. Le « Délier » du menu pause la révoque sur le Bridge (`POST /v1/unlink`,
capacité Bearer), pas seulement sur l'appareil.

## Clés et rotation

La clé d'événements signe chaque signal avec son `kid` ; le joueur se fie aux clés que liste `GET /v1/keys`, chacune
dans sa fenêtre, avec cinq minutes de tolérance pour l'horloge d'un appareil. Pour la faire tourner :
`npm run bridge -- rotate [--keep-days=30]` crée une nouvelle clé et garde l'actuelle dans `previousKeys` jusque-là,
puis redémarrer le Bridge. Dès lors le Bridge livre chaque signal sous sa clé courante : ce qui attendait un joueur est
signé de nouveau à la livraison (le journal garde le contenu tel qu'accepté), et un joueur dont le lien était ouvert
redemande les clés une fois quand un signal en nomme une qu'il ne connaît pas. `--keep-days` n'a à couvrir qu'un
joueur qui a reçu un signal juste avant la rotation et le vérifie après. Une clé compromise : la retirer de
`previousKeys` et redémarrer ; les joueurs refusent dès lors ce qu'elle a signé, et ce qu'elle a signé dans le journal
est livré de nouveau sous la nouvelle clé.

La clé racine Biscuit émet les jetons des connecteurs ; la changer, c'est donner un nouveau jeton à chacun.

## Révocation, quotas, limites

```sh
npm run bridge -- revoke --url=<bridge> --player=<p-…>      # le lien d'un joueur
npm run bridge -- revoke --url=<bridge> --token=<id de révocation>   # le jeton d'un connecteur
```

Quotas : signaux par connecteur et par minute (120), signaux en attente d'accusé pour un joueur (1000), corps de
requête (8 Ko). Au-delà, un 429, visible du connecteur, jamais un signal perdu en silence.

Les propositions pour un joueur sont prises une par une : la déduplication, les quotas, la séquence, la signature et
la ligne du journal sont décidées ensemble sous un verrou par joueur, donc deux connecteurs qui proposent en même
temps ne partagent jamais une séquence, et une `dedupeKey` n'est acceptée qu'une fois quel que soit le moment. Un
code de liaison confirmé par deux connecteurs à la fois n'est confirmé qu'une fois ; l'autre reçoit un 409.

## Conservation, export, suppression

Le journal (`journal.jsonl`) garde chaque signal accepté : son id, sa séquence, la clé du connecteur, l'enveloppe
signée ; jamais un jeton, un email ni un contenu. Le log (stdout) est en lignes JSON sans secret. Garder le journal
tant que des joueurs peuvent être hors ligne avec des signaux à recevoir ; ensuite un joueur se relie.

- `GET /v1/admin/players/<p-…>` (jeton de l'opérateur) : tout ce qui est gardé sur un joueur (son lien sans la
  capacité, ses signaux, son accusé).
- `DELETE /v1/admin/players/<p-…>` : le supprime, le fichier du journal réécrit sans aucune ligne sur ce joueur
  (chaque ligne lue comme un événement, jamais comparée comme du texte).
- `web-scumm-bridge doctor` : lit le journal et dit ce qu'il contient. Une dernière ligne coupée par un plantage est
  abandonnée au démarrage suivant, et dite dans le log (`journal.repaired`) ; toute autre ligne illisible est une
  corruption, et le Bridge refuse de démarrer plutôt que de deviner.
- `web-scumm-bridge compact [--retention-days=90]`, Bridge arrêté : réécrit le journal sans les appairages
  périmés, les versions antérieures de la ligne d'un joueur, et les signaux acquittés plus vieux que la rétention ;
  le dernier signal d'un joueur reste toujours (sa prochaine séquence se compte depuis lui), ainsi que tout ce qui
  n'est pas encore acquitté. Le journal ne grossit qu'avec ce qui attend encore, ou assez récent pour qu'un
  connecteur le répète.

## Ce qui n'est pas là (4.1.1)

Un vrai connecteur email ou SSH, un Bridge hébergé multi-locataire, la haute disponibilité. Le Bridge de référence est
pour un jeu, un développeur, un petit événement ; c'est le protocole qui reste.
