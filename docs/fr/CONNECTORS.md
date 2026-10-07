# Les connecteurs du monde extérieur

Un connecteur transforme ce qui se passe hors du jeu (un email arrive, une commande est tapée sur un terminal, un
badge est présenté) en l'un des signaux que le jeu déclare, et le propose au Reality Bridge
(`docs/fr/REALITY-OPS.md`). 4.1.9 en livre quatre : **email**, **Telnet**, **SSH** et **Open Badges**. Ils sont
**expérimentaux** (`docs/fr/SUPPORT.md`, D19) : tous les tests de contrat et d'abus tournent en CI, mais personne ne
les a encore lancés contre un vrai fournisseur d'email, un vrai badge ou un terminal exposé sur un réseau.

Chaque connecteur est un processus à part, jamais dans le jeu : le build du jeu ne contient rien de `connectors/`
(vérifié par `tools/dist.ts`), le DSL ne déclare que des données, et un jeu tourne sans aucun connecteur. Ce qu'un
connecteur lit est traité comme hostile ; chacun a son modèle de menace dans `docs/dev/threat-models/`. La conception
est l'ADR 0008.

## En lancer un

```sh
npm run bridge -- grant --connector=shed-telnet --source=terminal --signals=terminal.lamp --pair > telnet.token
npm run connector -- telnet --config telnet.json        # depuis le dépôt
npx web-scumm-connector telnet --config telnet.json     # depuis le paquet web-scumm-connectors
```

La configuration nomme le Bridge et le fichier du jeton du connecteur (jamais le jeton sur la ligne de commande), le
jeu, ses limites, un port de santé facultatif, et une section au nom du connecteur :

```json
{
  "bridge": { "url": "http://127.0.0.1:8787/", "tokenFile": "telnet.token" },
  "gameId": "signals",
  "limits": { "maxBytes": 4096, "maxPerMinute": 60, "timeoutMs": 5000 },
  "health": { "port": 9301 },
  "telnet": { "port": 2323 }
}
```

Le manifeste Reality du jeu vient du Bridge (`GET /v1/manifest`), ou de `"manifestFile"`. Un jeton émis avec
`--pair` peut confirmer les codes d'appairage que donnent les joueurs ; n'accordez à chaque connecteur que les signaux
qu'il propose. Avec `health`, `GET /health` et `GET /metrics` répondent sur 127.0.0.1 (nombre de propositions, de
doublons, de refus par code, d'entrées rejetées, de nouvelles tentatives). SIGTERM ou Ctrl-C l'arrête : plus d'entrée
nouvelle, le travail en cours vidé en cinq secondes au plus, sortie 0. Installer le paquet sans code natif :
`npm install --omit=optional --ignore-scripts web-scumm-connectors`.

## Déclarer ce que les connecteurs peuvent faire

Le jeu dit, en données, ce que chaque connecteur peut transformer en signal (`reality.connectors`, vérifié par
`npm run validate`). Chaque signal nommé là est l'un de `reality.signals` ; aucun motif, script ni chemin de
l'auteur n'atteint un connecteur.

```ts
reality: {
  signals: [
    { id: 'letter.door', source: 'email', availability: 'optional', replay: 'record' },
    { id: 'terminal.lamp', source: 'terminal', availability: 'optional', replay: 'record' },
  ],
  connectors: {
    email: { answers: [{ words: ['open', 'door'], signal: 'letter.door' }], otherwise: 'letter.unclear' },
    telnet: { prompt: 'shed> ', commands: [{ says: 'lamp on', reply: 'Click.', signal: 'terminal.lamp' }] },
    ssh: { commands: [/* les mêmes */], files: { '/notes/lamp.txt': 'La lampe obéit à deux mots.' } },
    'open-badge': { issuers: ['https://badges.example.org/issuer'], valid: 'badge.valid', revoked: 'badge.refused' },
  },
}
```

Un joueur relie un connecteur à son jeu comme n'importe quel connecteur : le « Lien au monde » du menu pause montre un
code, et le joueur le tape à l'invite du terminal, l'envoie comme sujet d'un email (`PAIR ABCD2345`), ou le poste avec
un badge. Le connecteur le confirme auprès du Bridge ; le jeu est alors relié.

## Email

Deux modes. `webhook` : un fournisseur (ou un petit adaptateur devant lui) poste le message brut sur
`POST /v1/inbound`, avec `X-Web-Scumm-Timestamp` (secondes Unix, à cinq minutes près) et
`X-Web-Scumm-Signature: sha256=<hex>`, un HMAC-SHA256 de `<timestamp>.<corps>` avec le secret de
`webhook.secretFile`. `imap` : le connecteur interroge une boîte en TLS toutes les `pollS` secondes (`imap.host`,
`user`, `passwordFile`, `mailbox`).

Un message est lu dans un thread worker (64 Mo, 2 s), 256 Ko au plus, 3 niveaux de multipart, 64 parties ; le HTML
devient du texte inerte ; un message avec une pièce jointe est refusé. Le joueur est l'étiquette du destinataire
(`gate+p-…@<domaine>`, avec `"domain"` renseigné) ou l'expéditeur qui a envoyé un code d'appairage (en mémoire,
`linkDays`, 30 par défaut). La première réponse dont tous les mots figurent dans le sujet ou le texte propose son
signal, sinon `otherwise`. La clé est `sha256('email:' + Message-ID)` : un message livré deux fois fait un seul
signal. Rétention : avec `imap.keepDays: 0` (par défaut) un message est supprimé dès que son signal est accepté ; les
messages refusés sont marqués et gardés pour l'opérateur. Aucune réponse n'est envoyée en 4.1.9.

## Telnet

`telnet: { "port": 2323, "host": "127.0.0.1" }`. Un serveur TCP qui refuse toutes les options Telnet et filtre les
octets du protocole. Le joueur tape le code d'appairage (ou le mot de reprise affiché lors d'un appairage précédent),
puis les commandes que le jeu déclare ; `help`, `clear` et `exit` sont celles du terminal. Une ligne fait 512 octets
au plus, 100 par minute ; une connexion envoie 64 Ko par seconde au plus, doit s'appairer en deux minutes, taper une
ligne par minute, et dure 30 minutes au plus ; 20 connexions à la fois. La clé est
`sha256('telnet:' + session + ':' + ligne)`. Telnet circule en clair : gardez-le sur un réseau local, derrière un VPN
ou TLS (stunnel), ou préférez SSH.

## SSH

`ssh: { "port": 2222, "hostKeyFile": "ssh_host_ed25519_key", "keys": [{ "key": "ssh-ed25519 AAAA…", "playerId": "p-…" }] }`.
Un serveur SSH (`ssh2`, JavaScript pur, ses parties natives refusées). Le mot de passe est un code d'appairage ou un
mot de reprise (trois essais) ; ou une clé publique que l'opérateur a déclarée pour un joueur. Seul un terminal
s'ouvre : les commandes du jeu, et `ls`, `cd`, `pwd`, `cat` sur le disque virtuel du jeu (`files`) ; `exec`, `sftp`,
l'environnement, l'agent et les redirections sont refusés. Les chemins ne quittent jamais l'arbre virtuel, rien de
tapé n'est interprété. La sortie est coupée à la largeur du terminal. Mêmes limites que Telnet. Générer la clé d'hôte
avec `ssh-keygen -t ed25519 -f ssh_host_ed25519_key -N ''`.

## Open Badges

`"open-badge": { "port": 8790, "hosts": ["badges.example.org"] }`. Un joueur poste
`{ "code": "ABCD2345", "badge": <une URL, un JWS compact, ou l'attestation>, "email": "…" }` sur `POST /v1/badges`.
Le connecteur vérifie Open Badges 2.0 (hébergé : l'assertion relue depuis son propre id ; signé : un JWS dont la clé
appartient à l'émetteur) et 3.0 (un VC-JWT, ou une preuve Data Integrity `eddsa-jcs-2022` ; les autres suites comme
`eddsa-rdfc-2022` donnent `indeterminate`), l'émetteur parmi les `issuers` du jeu, le bénéficiaire contre l'email
(haché avec le sel du badge, puis oublié), les dates, et la révocation (listes de révocation OB2, OB3
`1EdTechRevocationList` et listes de statut Bitstring, en cache un jour au plus). Le verdict (`valid`, `invalid`,
`expired`, `revoked`, `indeterminate`) propose le signal que le jeu déclare pour lui. Chaque document est récupéré
sous une politique réseau : `https:` seulement, hôtes de `hosts` (par défaut ceux des émetteurs), le nom résolu une
fois et aucune adresse privée, de bouclage ou locale au lien, deux redirections, 64 Ko, 10 secondes, un JSON imbriqué
sur 8 niveaux au plus, `@context` jamais récupéré. Le jeu ne reçoit jamais le badge.

## Ce qui sort d'un connecteur

Le Bridge reçoit le nom du signal, le joueur, la source, la clé de déduplication, l'heure, et le SHA-256 de la charge
utile du connecteur (`evidenceHash`) : jamais la charge, le message, la ligne ou le badge. La livraison est au moins
une fois et appliquée une fois : une proposition dont la réponse s'est perdue est renvoyée avec la même clé et le
Bridge répond `duplicate`. Le journal contient des événements, des identifiants et des nombres ; une chaîne qui
ressemble à du contenu (une espace, un `@`, une barre oblique) est écrite `[redacted]`. Ce que chaque connecteur
garde, et combien de temps : `docs/fr/PRIVACY.md`.

## Tester sans réseau

`npx vitest run tests/connectors-*.test.ts` lance le même contrat sur les quatre connecteurs contre un vrai Bridge sur
un port libre, leurs fixtures hostiles (`connectors/test-vectors/`), Telnet et SSH sous inondations, clients lents et
mille connexions, et les quatre pilotés sous `--disallow-code-generation-from-strings`. `npm run fuzz:connectors`
nourrit chacun de mutations à graine (`--cases`, `--seconds`, `--seed`). Les replays enregistrés d'un jeu
(`games/<id>/replays/*.json` : des entrées de connecteurs et les signaux qu'elles ont produits) sont rejoués à travers
le vrai code des connecteurs par `tests/connectors-replays.test.ts` et prouvés finissables par `npm run solve:reality`.

## Jouer le chapitre d'exemple

`games/signals` a un chapitre, « la boîte aux lettres et le terminal ». Reliez le jeu (menu pause, Lien au monde),
puis : écrivez au portail avec « open the door » dans le sujet ou le texte, et la porte de la cabane s'ouvre ; tapez
`lamp on` au terminal de la cabane (Telnet ou SSH), et une lampe s'allume dans le jardin ; montrez un badge de la
guilde du jardin, et un ruban se pose sur le seau. Rien de cela n'est nécessaire pour finir le jeu : la radio ouvre
toujours le portail.
