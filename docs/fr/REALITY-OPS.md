# Faire tourner un Reality Bridge

Le Bridge de référence (`bridge/src/`, le paquet `web-scumm-bridge`) sert un jeu. C'est un petit service Node :
appairage, connecteurs sous capacités Biscuit, un webhook de démonstration, un journal, des événements signés, des
Server-Sent Events. Depuis la 4.1.10 il garde son état dans un store (le journal de la 4.1.9, SQLite ou Postgres), et
un déploiement peut faire tourner plusieurs instances et servir plusieurs tenants. Pour les auteurs :
`docs/fr/REALITY.md`. Pour le pourquoi : `docs/dev/THREAT-MODEL.md` et `docs/dev/threat-models/constellation.md`.

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
Le paquet `web-scumm-bridge` (l'archive de la release) est un seul module JavaScript plus ses politiques Datalog et
son schéma SQL : il lui faut Node 22.12 ou plus (22.13 pour SQLite), le WebAssembly de Biscuit et zod ; `pg` seulement
pour Postgres, `@opentelemetry/api` seulement pour les mesures ; `web-scumm-bridge` est sa commande.

Derrière HTTPS : lancer `serve` sur `127.0.0.1` derrière un proxy inverse qui termine TLS et ne met pas en tampon les
réponses `text/event-stream`, avec `--trust-proxy` pour que les limites par adresse voient celle du client
(`X-Forwarded-For`). `--trust-proxy` seul fait confiance à la boucle locale ; `--trust-proxy=10.0.0.0/8,192.0.2.7`
nomme les proxies (adresses ou réseaux IPv4) : l'en-tête n'est lu que venant d'eux, et le client est son adresse la
plus à droite qui n'en est pas un. Depuis la 4.1.10 un proxy ailleurs que sur la boucle locale (le routeur d'un PaaS)
doit être nommé : sans quoi tous les clients partagent l'adresse du proxy et son unique compartiment. `--origin` liste le site du jeu (CORS) ; les routes du joueur ne répondent qu'à lui. Mettre
l'URL publique dans `reality.bridge` du jeu. Sur Internet, `init --no-demo-webhooks` et un `grant` par connecteur,
chacun aussi étroit que sa tâche.

Par adresse, les routes que n'importe qui peut appeler (un code, son état, les clés, le manifeste) répondent à 60
requêtes par minute, et 60 authentifications ratées par minute sur les autres refusent un moment toute requête de
cette adresse (429, `Retry-After`). Les codes en attente de confirmation sont 1000 au plus tous joueurs confondus et
balayés une fois expirés : en mémoire sur le journal (un redémarrage les oublie), dans la table `pairings` sur SQLite
et Postgres (n'importe quelle instance peut en confirmer ou en réclamer un). Aucune capacité n'attend nulle part :
elle est tirée quand le joueur réclame le code, et seule son empreinte est gardée.

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
peut proposer. Les connecteurs de 4.1.9 (email, Telnet, SSH, Open Badges ; expérimentaux) tournent comme processus à
côté du Bridge, chacun avec son jeton : `docs/fr/CONNECTORS.md`.

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
signée et, depuis la 4.1.2, la charge du signal telle qu'acceptée (pour la re-signer après une rotation) ; jamais un jeton ni un email. Le log (stdout) est en lignes JSON sans secret. Garder le journal
tant que des joueurs peuvent être hors ligne avec des signaux à recevoir ; ensuite un joueur se relie.

- `GET /v1/admin/players/<p-…>` (jeton de l'opérateur) : tout ce qui est gardé sur un joueur (son lien sans la
  capacité, ses signaux, son accusé).
- `DELETE /v1/admin/players/<p-…>` : le supprime, le fichier du journal réécrit sans aucune ligne sur ce joueur
  (chaque ligne lue comme un événement, jamais comparée comme du texte).
- `web-scumm-bridge doctor` : lit le journal et dit ce qu'il contient. Une dernière ligne coupée par un plantage est
  retirée au démarrage suivant, et dite dans le log (`journal.repaired`) ; toute autre ligne qui ne se lit pas, ou
  qui se lit mais n'est pas un événement de la forme du journal (chaque champ vérifié, 4.1.8), est une corruption,
  et le Bridge refuse de démarrer plutôt que de deviner.
- Un Bridge par journal (4.1.8) : le Bridge en marche tient `journal.jsonl.lock` avec l'identifiant de son
  processus ; un second démarrage sur le même fichier refuse tant que ce processus vit, et reprend un verrou laissé
  par un plantage (dit dans le log). Un arrêt par Ctrl-C ou SIGTERM libère le verrou. `compact` prend le verrou lui
  aussi : il refuse tant que le Bridge tourne. Un verrou dont l'identifiant de processus a été réutilisé par un autre
  processus depuis le plantage est refusé comme « en cours d'usage » : regardez, puis supprimez-le. Le verrou est un
  lien dur : le dossier du journal doit être sur un système de fichiers qui les tient (APFS, ext4, NTFS oui ; FAT et
  certains montages réseau non).
- `web-scumm-bridge compact [--retention-days=90]`, Bridge arrêté : réécrit le journal sans les appairages
  périmés, les versions antérieures de la ligne d'un joueur, et les signaux acquittés plus vieux que la rétention ;
  le dernier signal d'un joueur reste toujours (sa prochaine séquence se compte depuis lui), ainsi que tout ce qui
  n'est pas encore acquitté. Le journal ne grossit qu'avec ce qui attend encore, ou assez récent pour qu'un
  connecteur le répète.

## Stores et profils

| Profil | Store | Pour |
|---|---|---|
| `local` | SQLite (`node:sqlite`, Node 22.13+, un fichier, WAL) | une machine, un ou quelques processus ; le profil de `npm run bridge` |
| (4.1.9) | le journal JSON-lines | une configuration écrite avant la 4.1.10 continue d'en servir ; un processus |
| `distributed` (`experimental`) | Postgres (`pg`) | plusieurs instances derrière un répartiteur ; expérimental jusqu'à un vrai déploiement |

`init --store=sqlite` écrit `"store": "sqlite:bridge.sqlite"` dans `config.json` ; sans lui, `init` écrit encore la
configuration du journal en 4.1.10 (le défaut passe à SQLite quand le moteur exigera Node 22.13, D20). Une URL de
base n'est pas écrite dans le fichier : `serve --store=postgres://…` ou `BRIDGE_STORE=postgres://…`. Le schéma est
versionné (`bridge/migrations/`) : un store SQL le monte à son ouverture ; `migrate --schema=N` monte ou descend à la
main, et une base plus récente que le Bridge est refusée. Le fichier SQLite et ses `-wal` et `-shm` sont en mode
0600 ; une écriture qui attend plus de 5 s le verrou d'un autre processus reçoit un 503 avec `Retry-After` (le
connecteur la répète).

```sh
npm run bridge -- migrate --from=jsonl --to=sqlite [--tenant=<id>]   # Bridge arrêté ; le journal est gardé
npm run bridge -- doctor                                              # un store lu sans changement
```

`migrate --from=jsonl` lit le journal sous son verrou, écrit chaque joueur, signal, acquittement et révocation dans le
nouveau store, les relit, puis nomme le nouveau store dans `config.json` (pas pour une URL). `doctor` sur un store
SQL affiche la version de son schéma et, par tenant, les joueurs, les signaux, tout trou dans la séquence d'un joueur
(sortie 1) et les lignes en quarantaine. `compact` est la commande du journal ; un store SQL garde tous les signaux en
4.1.10.

## Plusieurs tenants, plusieurs instances

Un tenant est le jeu d'un opérateur dans un environnement : son propre répertoire (`init --tenant=<id>
--environment=prod|staging|dev --hosts=bridge.a.example`), sa propre racine Biscuit, sa clé d'événements, son jeton
d'opérateur, ses quotas, sa rotation et ses révocations. Un serveur en tient plusieurs sur un même store SQL :

```sh
BRIDGE_STORE=postgres://… npm run bridge -- serve --tenants=/srv/bridge/a,/srv/bridge/b [--tenant-header]
```

Une requête est routée par son `Host` (les `hosts` de chaque tenant), ou par `X-Web-Scumm-Tenant` avec
`--tenant-header`, avant toute lecture ; pas de tenant, un 404. Chaque ligne du store porte son tenant et chaque
requête filtre dessus. Un tenant d'un déploiement partagé signe en `SignalV2` (ADR 0010 : le signal nomme son tenant,
son environnement, son origine, son lien et sa clé) et les jetons de ses connecteurs lui sont liés (`grant` ajoute le
tenant), si bien que ni un jeton ni un signal d'un tenant n'est accepté par un autre, même quand on a (à tort) donné
une même clé à deux d'entre eux.

Les instances sont sans état : en lancer autant que nécessaire sur le même store, sans session collante. Séquences,
déduplication et acquittements se décident dans une transaction de la base ; un signal accepté par une instance
atteint un flux tenu par une autre, qui lit le store quand on la réveille (`NOTIFY` de Postgres, un sondage de 250 ms
sur SQLite, et un passage toutes les 5 s si un réveil se perd). La livraison est au moins une fois, appliquée une fois
(D20). Chaque instance borne ses flux ouverts (`streamsPerInstance`, 10 000 ; puis 429) et sa minute par connecteur
(avec N instances, un connecteur peut proposer N fois son quota). Une ligne stockée qui ne se vérifie plus est mise
en quarantaine, jamais livrée, et `doctor` la liste.

## Le déploiement de référence (4.1.18)

`ops/qualify/` est le profil distribué sous forme de déploiement reproductible : un proxy HTTPS (Caddy), trois Bridge
construits depuis le tarball `web-scumm-bridge`, un Postgres, deux tenants, chaque image épinglée par digest, les
Bridge en lecture seule et sans privilège, le mot de passe et l'URL de la base en fichiers secrets
(`BRIDGE_STORE_FILE`), Postgres jamais publié. `npm run ops:qualify` le démarre, tue une instance pendant des
propositions, tient un flux sur une autre, vérifie que les tenants restent séparés, puis sauvegarde, détruit la
topologie avec sa base et la restaure (`ops/qualify/README.md`). Le profil `distributed` reste `experimental` tant que
la passe humaine derrière un vrai domaine (24 à 48 heures) n'est pas `passed`.

## Santé, mesures, sauvegardes

- `GET /livez` : le processus répond. `GET /readyz` : le store répond (503 sinon). `GET /healthz` : les deux, avec les
  tenants, la nature du store et les flux ouverts. Pas de jeton, aucune donnée d'un tenant.
- Mesures : acceptations, doublons, refus par code, acquittements, nouvelles tentatives du store, quarantaine, flux
  refusés, l'arriéré et la latence d'une proposition. Dans le processus toujours ; via l'API de métriques
  d'OpenTelemetry quand `@opentelemetry/api` est installé à côté du Bridge, exportées en OTLP quand
  `OTEL_EXPORTER_OTLP_ENDPOINT` est défini et `@opentelemetry/sdk-node` installé. Attributs : le tenant et un code,
  jamais un joueur ni un contenu.
- `npm run bridge -- backup --out=<fichier>` (4.1.19, schéma 3, ADR 0021) écrit tout le store comme **un seul
  instantané** (tenants, runs et enregistrements quotidiens lus dans une seule transaction en lecture) dans un fichier
  en mode 600, écrit dans un fichier temporaire puis renommé : des empreintes de capacités, jamais une capacité ni une
  clé. Son enveloppe donne le backend, les versions du Bridge et du schéma SQL, le début et la fin, les comptes par
  famille et un SHA-256 du contenu. Borné : un store au-delà de `--max-rows` (2 000 000) ou un fichier au-delà de
  `--max-bytes` (256 Mio) est refusé, sans fichier écrit.
- `restore --from=<fichier>` est **tout ou rien** : le fichier est lu de façon bornée et vérifié en entier (schémas 1,
  2 et 3 ; chaque ligne, les doublons, les relations, les comptes et l'empreinte du schéma 3) avant l'ouverture du
  store ; tenants, runs et enregistrements quotidiens sont écrits dans une seule transaction, relus et comparés avant
  sa validation. Un conflit (un tenant, une run de ses tenants, une clé quotidienne) le refuse sans `--force` ; avec
  `--force`, ils sont remplacés dans la même transaction. Un échec dit « rien restauré » et laisse le store tel qu'il
  était ; une différence trouvée après la validation est annoncée comme un P0 (code de sortie 3). Il faut un store
  SQL : le journal JSON-lines est refusé avant d'être touché (le migrer vers SQLite, puis restaurer). Répété par
  `tests/bridge-backup.test.ts` et `tests/bridge-ops.test.ts`.
- La sauvegarde est logique, portable et bornée. Pour un gros déploiement, `pg_dump` ou les instantanés du
  fournisseur restent la sauvegarde de la base elle-même.
- `tenant export --tenant=<id> [--out=<fichier>]`, `tenant delete --tenant=<id> --yes` : les lignes d'un tenant, dans
  toutes les tables.

## Procédures

**Une clé d'événements compromise (un tenant).** `rotate --dir=<tenant>`, puis retirer la clé compromise de
`previousKeys` dans le `config.json` de ce tenant, et redémarrer ses instances. Les joueurs refusent dès lors ce
qu'elle a signé ; ce qui les attend est signé à nouveau sous la nouvelle clé à la livraison. Les autres tenants ne
sont pas touchés.

**Une racine Biscuit compromise.** `init --force` serait trop : faire une nouvelle racine (`init` dans un répertoire
de brouillon, en copier `biscuitRoot` et `root.key`), donner un nouveau jeton à chaque connecteur du tenant,
redémarrer, puis révoquer les identifiants des anciens jetons (`revoke --token=`) pour la fenêtre avant le redémarrage.

**Une instance ou son hôte compromis.** Elle tenait toutes les clés privées des tenants qu'elle servait : faire
tourner la clé d'événements de chaque tenant, donner à chacun une nouvelle racine, changer le mot de passe de la base
et les jetons d'opérateur, et lire la `quarantine` du store et les journaux depuis la compromission.

**La rotation, en routine.** Par tenant, à son propre rythme : `rotate --dir=<tenant> --keep-days=30`, redémarrer
ses instances une à une (les autres continuent de servir ; le store est le même).

**La reprise.** Une instance tuée ou plantée : en lancer une autre ; rien n'est perdu (une transaction est validée ou
absente, `tests/bridge-fanout.test.ts` en tue une sur trois pendant 1 000 propositions). La base perdue : `restore` la
dernière sauvegarde dans une nouvelle, puis `doctor` ; les connecteurs répètent ce qu'ils ont envoyé depuis (leur
`dedupeKey` le rend idempotent), et les joueurs gardent leurs curseurs. Un journal qui ne démarre pas : `doctor` nomme
la ligne.

## Classements et défi du jour (4.1.16)

La section `runs` d'une configuration monte `/v1/runs`, sa section `daily` `/v1/daily`, `/v1/commit` et
`/v1/reveal/<id>` (docs/fr/SPEEDRUN.md, « Classements sur le Bridge »). Les deux gardent leurs enregistrements dans le
store SQL (`--store=sqlite:<fichier>` ou `BRIDGE_STORE=postgres://…` ; `serve` les refuse sur le journal JSON-lines),
migrations 0002 à 0004.

Les limites de la file valent pour toutes les instances ensemble (4.1.17) : `maxQueued` (100 par défaut, runs en
attente ou en vérification) est compté et écrit dans une seule transaction sous le verrou du tenant ; `perMinute` (10
par défaut et par client) est un compteur par client dans la table `run_quota`. Le client est l'adresse du socket, ou
celle que nomme un proxy de confiance (`--trust-proxy`) : seul un HMAC en est gardé, avec un secret que chaque instance
du tenant dérive de sa clé d'événements. Faire tourner la clé d'événements (`kid`) fait tourner ce secret : chaque
client repart d'un compteur neuf (au plus une minute de quota en plus), et les anciens compteurs sont purgés avec les
inactifs. Une limite globale au proxy reste utile devant le tout.

```json
"runs": {
  "games": { "reference": { "dir": "/srv/games/reference", "fingerprint": { "logic": "…", "trustedExtensions": "…", "presentation": "…", "engine": "…" } } },
  "worker": ["/usr/bin/node", "/srv/web-scumm/node_modules/tsx/dist/cli.mjs", "/srv/web-scumm/tools/speedrun/worker.ts"],
  "workers": 2
},
"daily": { "games": { "reference": { "daily": "daily", "mystery": "mystery" } }, "kid": "daily-2026", "keyFile": "daily.jwk", "secretFile": "daily.secret" }
```

`keyFile` (la JWK privée Ed25519 dont le manifeste du jeu nomme la moitié publique dans `remix.daily`) et `secretFile`
(le secret des jours) sont à côté de `config.json`, en mode 0600. Faire tourner la clé du jour, c'est publier le jeu
avec la nouvelle clé publique : le joueur et le vérificateur n'acceptent que la clé que nomme le manifeste, et un jeton
d'un autre `kid` est refusé.

### Le worker des speedruns

Le refus du réseau dans le processus du worker est une défense en profondeur, pas un bac à sable : un rejeu exécute le
code du jeu, et un paquet ou un run hostile pourrait encore atteindre le système de fichiers, lancer un processus ou
ouvrir un socket autrement. Lancez la commande du worker dans l'isolation du déploiement, par exemple :

```sh
docker run --rm -i --network none --read-only --tmpfs /tmp:rw,size=64m --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 512m --memory-swap 512m --cpus 1 --user 65534:65534 -v /srv/games:/srv/games:ro web-scumm-worker \
  timeout -s KILL 70 node tools/speedrun/worker.ts
```

comme commande `worker` : pas d'espace réseau, une racine en lecture seule, un répertoire temporaire borné, aucune
capacité, aucun secret du Bridge dans son environnement (le Bridge ne passe que `PATH`, `GAME_DIR` et `NODE_OPTIONS`),
des limites de CPU, de mémoire (sans swap au-delà), de processus et de temps (le Bridge tue le groupe de processus à
`timeoutMs` + 5 s). Sa sortie standard est plafonnée à 1 Mo et sa sortie d'erreur n'est pas gardée. Tout dossier monté
est lisible à l'intérieur : le dossier du Bridge (`config.json`, ses clés et ses fichiers de jeton) reste hors du dossier
du moteur monté en `/app`.
Tuer le client `docker` n'arrête pas son conteneur : c'est le `timeout -s KILL` à l'intérieur (un peu plus que le
`timeoutMs` du Bridge) qui met fin à un rejeu trop long, si bien que les conteneurs expirés ne s'accumulent jamais.

Depuis 4.1.17 ce profil est une fonction (`tools/speedrun/container.mjs`, `workerContainerArgs`) : `node
tools/speedrun/container.mjs --image=<image> --app=<dossier du moteur> [--games=<dossier>]` écrit la commande `worker`,
**sans réseau sauf `--allow-network`** (qui le dit sur stderr). Le job `worker-container` de la CI (`npm run
e2e:worker-container`, Linux et Docker) y lance le run de référence, puis un script hostile : HTTP, DNS et TCP refusés,
rien écrit hors de `/tmp`, les secrets de l'hôte invisibles, un processus enfant permis mais sans réseau, le conteneur
tué par son propre timeout sans rien laisser tourner ; puis un run de nouveau.

### Modération

`runs.adminTokenFile` nomme le fichier du jeton qui modère les classements d'un tenant (`POST
/v1/runs/<id>/moderate`, `Authorization: Bearer …`) : à côté de `config.json`, mode 0600, 32 caractères au moins ;
`serve` refuse de démarrer s'il manque, s'il est plus court ou ouvert à d'autres (sur un système POSIX ; sous Windows,
l'ACL du dossier décide). Sans lui, pas de route de modération (404, rien n'est compté). Le jeton est comparé par empreintes de même longueur (sa longueur ne se devine pas non plus) ; chaque refus
est une ligne d'audit (`run.moderation-refused`, jamais le jeton), et `/healthz` compte les modérations acceptées et
refusées.

## Ce qui n'est pas là (4.1.10)

Un vrai connecteur email ou SSH, un déploiement du profil `distributed` (il reste `experimental` jusque-là), une
sécurité par ligne et par tenant dans Postgres, une rétention sur un store SQL, une limite par connecteur partagée
entre instances. Le Bridge de référence est pour un jeu, un développeur, un événement ou les jeux d'un petit studio ;
c'est le protocole qui reste.
