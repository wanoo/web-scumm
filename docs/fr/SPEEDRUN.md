# Speedrun (4.1.14 « Time Attack »)

Un jeu fait avec web-scumm peut déclarer des catégories de speedrun dans son contenu. Le joueur lance une tentative
depuis le menu pause, le moteur la chronomètre, la découpe en splits sur ce qui se passe dans le jeu (jamais sur des
pixels) et scelle le run dans un fichier `.wsrun` que n'importe qui peut rejouer et vérifier. La conception est dans
`docs/dev/adr/0016-run-clock-and-envelope.md` (l'horloge, le générateur à graine, la preuve chaînée) et
`docs/dev/adr/0017-speedrun-verdicts-and-trust.md` (verdicts et confiance). Rien ici ne promet de détecter toute
triche : un rejeu prouve qu'un run est possible et que son temps de jeu est exact ; seule l'observation d'un serveur
ou d'un humain élève la confiance au-delà.

## Pour les joueurs

- **Départ** : menu pause › **Speedrun** (`ui.speedrun`) › une catégorie. Le jeu repart avec la graine de la
  catégorie ; un petit chronomètre montre la catégorie, le temps sur lequel elle classe et le dernier split.
- **Pendant le run** : le menu pause propose **Abandonner le run** (`ui.abandonRun`). L'ouvrir est enregistré comme
  une pause ; le passage de l'onglet en arrière-plan aussi. Ni l'un ni l'autre n'arrête le temps de jeu (le jeu ne
  tourne pas pendant qu'il attend).
- **À l'arrivée** : le run est scellé ; le menu pause propose **Exporter le run** (`ui.exportRun`) : un fichier
  `.wsrun`, la preuve à envoyer à un classement ou à un ami. Le panneau de dev (`?dev`) offre le même export.
- **Les records** restent sur l'appareil (IndexedDB `web-scumm-runs`, hors ligne) : le meilleur run personnel et ses
  splits, le meilleur segment de chaque split, la somme des meilleurs, les tentatives, arrivées, abandons, les notes.
  Un run reprend après un crash ou un onglet fermé depuis son dernier chunk enregistré (toutes les 500 entrées) ; ce
  qui a été joué après est rejoué.
- **Le fantôme** est le meilleur run personnel joué à côté de vous, sur des cibles sémantiques : le lieu où il est,
  l'action qu'il fait et ce qu'il porte, l'avance ou le retard à chaque split. Il est **désactivé la première fois**
  qu'une catégorie est jouée sur cet appareil (il montrerait les solutions des énigmes).

## Définir des catégories

`GameDef.speedrun` (types dans `docs/fr/API.md`, vérifiés par `npm run validate`), en contenu seulement : une nouvelle
catégorie ne demande aucun changement du moteur (`tests/speedrun-manifest.test.ts` le prouve avec un jeu de test).

```ts
speedrun: {
  rulesVersion: 1,
  categories: [
    { id: 'any%', name: 'Any%', timing: 'igt',
      start: { event: 'sessionStarted', session: 'new' }, finish: { event: 'endingReached' },
      allowSaves: true, allowPauses: true, allowHints: true, reload: 'allowed', realityPolicy: 'forbidden',
      fingerprint: ['logic', 'trustedExtensions'],
      inputs: { mouse: true, touch: true, keyboard: true, gamepad: true, macros: 'forbidden' } },
  ],
  splits: [
    { id: 'ladder', name: 'Échelle', at: { event: 'objectiveCompleted', objective: 'ladder' } },
    { id: 'end', name: 'Festival', at: { event: 'endingReached' } },
  ],
},
```

Un déclencheur nomme un événement sémantique (`roomEntered`, `itemAcquired`, `itemLost`, `flagChanged`,
`objectiveCompleted`, `endingReached`, `sessionStarted`, `playerSwitched`…) et les champs qu'il doit égaler (`room`,
`item`, `flag` avec `value`, `objective`, `ending`, `player`). `reload` dit ce que fait un chargement : il
`invalidates` le run, ou il est `allowed` (un état que le run a lui-même atteint) ; `segment` (un chargement qui ouvre
un segment chronométré) est réservé, pas implémenté en 4.1.14 : le validateur le refuse.
`seed: 'fixed'` fait tirer chaque run de `fixed:<id>` ; `seed` ne dit que le générateur du run. Depuis 4.1.16 (D29,
ADR 0019), le monde où un run se joue est `world` : `{ policy: 'story' }` (par défaut), `'fixed'` avec sa `fixedSeed`
publiée, `'random'` (n'importe quel monde de `mode`, classés ensemble), `'daily'` (la graine du jour signée par le
Bridge) ou `'mystery'` (une graine à laquelle le Bridge s'engage avant le départ), chacun avec le `mode` Remix d'où
viennent ses mondes. Le `seed: 'daily' | 'mystery'` de 4.1.15 sans `world` est lu comme ce monde (un run aléatoire
dedans), avec un avertissement. Les règles portent leur version : un changement ne requalifie
jamais un ancien run (`rulesVersion` différente : `unsupported-version`). Le validateur refuse un événement inconnu, un
id qui ne nomme rien, un départ égal à l'arrivée, une catégorie sans entrée, une politique Reality sans `reality`, un
split qui est son propre ancêtre ; il avertit pour un drapeau jamais posé et une catégorie qui n'exige pas `logic`. Le
chapitre de référence déclare Any%, Any% sans indices et Temps réel (`games/reference/game.ts`).

## Le temps : RTA, IGT, IGT actif

- **RTA** : l'horloge monotone de la page, du déclencheur de départ à l'arrivée. Jamais reproductible, jamais une
  autorité : un run chronométré en `rta` se rejoue valide mais reste hors classement sans témoin.
- **IGT** (`logicalTime`) : la somme des durées déclarées de ce que le moteur a exécuté (`core/timing.ts`,
  `TIMING_VERSION = 1`) : une réplique 2,2 s quels que soient son texte et sa langue, une marche sa distance divisée
  par la vitesse de marche entre ancres logiques, un `wait`, une animation, un panoramique, un mouvement leurs
  millisecondes ; une cinématique passée ne coûte rien. Le temps de réflexion n'y est pas. En microticks (1 ms =
  1 000), un `bigint` écrit en chaîne décimale.
- **IGT actif** : l'IGT moins ce qui a tourné dans une cinématique.
- **Pas logiques** : un par entrée de la session.

L'horloge du run (`Engine.runClock`) observe le moteur et n'écrit jamais l'état (D24).

## Splits, routes, records et fantôme

Les splits sont automatiques : chacun se déclenche une fois, la première fois que son déclencheur correspond après le
départ ; un split qui ne se déclenche jamais est marqué manqué et le run continue. Un `parent` en fait un sous-split.
Les records comparent un run au meilleur personnel (avance ou retard à chaque split), gardent le meilleur segment de
chaque split et leur somme.

Une **route** est un fichier `.wsroute` (JSON canonique) : les entrées d'un run, éventuellement ses splits. L'onglet
Play du Studio exporte la session de son cadre comme route, en importe une et en compare deux (première entrée
différente, écarts des splits). Le témoin du solveur devient une **route logique** (`kind: 'logical'`) : une
référence pour le routage, jamais un record.

## La preuve : `.wsrun`

Schéma 2 depuis 4.1.16 (`SpeedrunEnvelopeV2`, ADR 0019) : le jeu, son empreinte (le jeu tel qu'écrit, avant tout
monde), les versions du moteur, du générateur et des durées, la catégorie et la version de ses règles, la graine du
générateur du run (`runSeed`), le monde exact joué (`variant`, affectations comprises, jamais régénéré depuis une
graine) et, pour un monde Daily ou Mystery, les jetons signés du Bridge (`worldEvidence`), le temps (RTA, pas, IGT, IGT actif, les pauses, menus, arrière-plans
et chargements déclarés), les splits, les entrées en chunks de 500 chaînés par SHA-256 de `H0` (les règles) à `Hn`,
les chargements, les entrées utilisées, les signaux Reality, le hash de l'état final et la preuve finale. `H0` scelle
aussi le monde (son hash, la politique de monde de la catégorie, le hash des preuves, la version de l'algorithme Remix) :
les mêmes entrées dans deux mondes font deux runs. Chaque hash porte sur `canonicalJson`. La confiance exportée est
toujours `local`. Un fichier de schéma 1 (4.1.14, 4.1.15) se lit toujours, comme un run Story ; présenté à une
catégorie Remix il est refusé (`legacy-world-missing`), jamais requalifié d'après sa graine.

## Vérifier un run

```
npm run speedrun:verify -- run.wsrun [--keys=bridge-keys.json] [--json]
web-scumm speedrun verify run.wsrun
```

L'outil MCP `speedrun_verify` fait de même pour un assistant. Le vérificateur recharge la catégorie depuis le jeu,
vérifie le monde du run contre le jeu (`loadVariant`) et contre sa catégorie (`worldVerdict`, le jeton du jour ou
l'engagement et la révélation Mystery vérifiés avec la clé que nomme `remix.daily`), reconstruit ce monde, rejoue les
entrées avec la graine du run (les tirages aléatoires sont refaits, jamais pris dans le fichier), recalcule
l'horloge, les splits, l'état final et la chaîne, puis vérifie les règles, et nomme le classement où va le run
(`world.leaderboardKey` : la catégorie, et pour Fixed et Daily la graine). Code de sortie 0 pour `valid` et
`valid-unranked`.

| Verdict | Codes |
|---|---|
| `valid` | `ok` |
| `valid-unranked` | `rta-unverifiable`, `mystery-unwitnessed` (un run Mystery : son heure de départ est la parole du client) |
| `invalid-category-rule` | `unknown-category`, `hints-forbidden`, `saves-forbidden`, `pauses-forbidden`, `reload-forbidden`, `foreign-load`, `input-forbidden`, `reality-forbidden`, `seed-policy`, `start-trigger`, `world-policy`, `legacy-world-missing`, `daily-proof-missing`, `daily-proof-invalid`, `mystery-commitment`, `mystery-reveal`, `mystery-start-window` |
| `invalid-replay` | `envelope-shape`, `chunk-order`, `chunk-hash`, `chain`, `replay-diverged`, `rnd-mismatch`, `time-mismatch`, `splits-mismatch`, `final-state`, `not-finished`, `world-missing`, `world-shape`, `world-hash`, `world-value`, `world-constraint`, `world-stale` |
| `modified-game` | `fingerprint` |
| `missing-reality-proof` | `signal-missing`, `signal-signature`, `signal-mismatch` |
| `unsupported-version` | `schema`, `engine-version`, `prng-version`, `timing-version`, `rules-version` |
| `inconclusive` | `timeout`, `crash`, `no-keyring`, `package-not-approved` (le worker du Bridge) |

`inconclusive` n'est jamais valide. Un run Any% complet du chapitre de référence est versionné
(`tests/fixtures/speedrun/reference-any.wsrun`, schéma 2, fait par `tools/speedrun/reference-run.ts`), vérifié par un
test et par le workflow de release, qui l'attache à chaque release ; le fichier de schéma 1 de 4.1.15 est gardé comme
fixture de référence (`reference-any.v1.wsrun`).

## Niveaux de confiance

`local` (chronométré par la machine du joueur) → `replay-valid` (un vérificateur autre que le client l'a rejoué) →
`server-witnessed` (le serveur a daté les chunks du run pendant qu'il était joué : réservé, pas en 4.1.14) →
`moderator-verified` (un humain muni du jeton d'administration du classement l'a regardé). Seul quelqu'un d'autre que
le client élève un niveau ; une enveloppe qui en réclame davantage est lue comme `local`. Le niveau s'affiche dans les
records, le Studio et le classement.

## Politiques Reality

- `forbidden` : aucun signal extérieur ; un signal dans le run est `reality-forbidden`.
- `recorded` : chaque signal appliqué est gardé avec son JWS signé, l'id de sa clé et son hash ; le vérificateur
  vérifie la signature avec les clés publiques du Bridge (`--keys`, `GET /v1/keys`). Sans preuve :
  `missing-reality-proof`.
- `live` : la même preuve, dans une catégorie à part (la latence et la disponibilité d'un signal en direct ne sont pas
  reproductibles). Sans les clés, le vérificateur ne peut pas conclure (`no-keyring`).

## Streaming : OBS et LiveSplit

Des outils locaux sur la machine du joueur (D23), jamais sur le Bridge, jamais dans la PWA. Ouvrez le jeu avec
`?speedrunTool=<port>` : la page envoie les événements de son run (catégorie, ids et noms des splits, temps ; rien
d'autre) à `127.0.0.1:<port>`. Les outils n'acceptent que les événements de l'origine du jeu (le serveur de dev et la
préversion par défaut, `--origin=<url>` pour un build déployé) : une autre page ouverte dans le navigateur ne peut pas
envoyer de faux splits.

- `npm run speedrun:overlay -- --port=7777` : une Browser Source OBS à `http://127.0.0.1:7777/?mode=full`
  (`compact`, `transparent`), en Server-Sent Events.
- `npm run speedrun:livesplit -- serve --port=7778` : pilote LiveSplit par son propre serveur WebSocket (Control ›
  Start WebSocket Server) : départ, temps de jeu, split, saut, pause, remise à zéro. `export run.wsrun` écrit un `.lss`
  LiveSplit avec les splits du run comme meilleur personnel.

## Classements sur le Bridge

`bridge/src/runs.ts`, monté par `npm run bridge -- serve` quand la configuration a une section `runs` (4.1.16 ;
l'option `runs` de `bridgeServer` pour un hôte à soi) : `POST /v1/runs` avec `{ player, envelope }` rend l'id du run et
un jeton de suppression. Les runs sont gardés dans le store SQL du Bridge (`sqlite:` pour une machine, Postgres pour
plusieurs instances ; `bridge/migrations/0002`) et survivent à un redémarrage. Les workers de toutes les instances
partagent une seule file : un run est **créé une fois** (sa clé est unique : deux instances qui reçoivent le même run
en créent un), **réclamé par un seul worker** sous un bail, et **réclamé de nouveau** quand son worker est mort et que
le bail a expiré ; un worker qui a perdu son bail ne peut pas enregistrer de verdict. Chaque worker est un **processus
isolé** (`tools/speedrun/worker.ts`) : un tas borné, tué avec son groupe de processus à son budget de temps, un
environnement qui ne contient que `PATH`, le dossier du paquet du jeu et la taille du tas (aucun secret du Bridge),
fetch, WebSocket, TCP, UDP et DNS refusés dans le processus (une défense en profondeur, pas un bac à sable : voir
REALITY-OPS, « Le worker des speedruns »), le paquet vérifié contre son empreinte approuvée, sa réponse signée par une
clé à usage unique. Le processus HTTP ne rejoue jamais. Un run est identifié par son jeu, sa catégorie, la graine du
run et ses entrées (hors leurs horodatages RTA), jamais par son monde : le premier qui le soumet le garde, une copie
réhorodatée ou rescellée dans un autre monde est refusée. Un client peut soumettre dix runs par minute
(`perMinute`) ; la file tient au plus `maxQueued` runs, toutes instances confondues ; l'enveloppe est jetée une fois le
verdict enregistré ; les vieux runs sont purgés chaque heure. `GET /v1/runs?game=&category=[&key=]` est un classement :
runs valides seulement, le meilleur de chaque joueur, sur la **clé du vérificateur** (`world.leaderboardKey` : la
catégorie, et pour un monde Fixed ou Daily `<catégorie>:<graine>`) ; des temps égaux partagent un rang, puis la
soumission la plus ancienne passe devant. Un run Daily envoyé après son jour est un entraînement (valide, non classé) ;
un run Mystery est `valid-unranked` sans témoin serveur. `&seed=fixed|random` filtre toujours les runs de 4.1.14.
`GET /v1/runs/<id>` est un run, `DELETE /v1/runs/<id>` avec `x-delete-token` le supprime,
`POST /v1/runs/<id>/moderate` avec le jeton d'administration l'élève à `moderator-verified`. Soumissions, verdicts,
modérations et suppressions sont des lignes d'audit du journal du Bridge.

Le défi du jour (`bridge/src/daily.ts`, la section `daily` d'une configuration) : `GET /v1/daily?game=[&date=]` signe
la graine du jour (un vrai jour UTC, aujourd'hui ou dans `retentionDays`, 30 par défaut) ; `POST /v1/commit` et
`GET /v1/reveal/<id>` s'engagent sur une graine Mystery et la révèlent, signés tous les deux. Jetons et engagements sont
écrits une seule fois dans le même store SQL : toutes les instances répondent la même chose. Le joueur garde le jeton
d'un monde Daily à côté du monde, et un speedrun dans ce monde le porte ; le joueur n'a pas encore de parcours Mystery
(une catégorie Mystery y refuse de démarrer).

## Politiques

- **Mods et extensions** : une catégorie nomme les composants d'empreinte qu'un run doit égaler. `logic` seul admet un
  mod qui change les images ou la musique ; `trustedExtensions` refuse celui qui change le code du jeu ;
  `presentation` refuse tout changement d'image. Un run dont les composants diffèrent est `modified-game`.
- **Anciennes versions du moteur** : un run est rejoué par le moteur sur lequel il a été enregistré. Le worker doit
  rejouer un run plus ancien avec l'archive de cette release (version épinglée) ; en 4.1.14 le vérificateur ne rejoue
  que sa propre version et dit `unsupported-version` (`engine-version`) pour une autre.
- **Rétention** : un classement garde un run 90 jours par défaut (`retentionDays`) et le supprime sur demande avec le
  jeton donné à la soumission.
- **Anonymat** : un classement montre un pseudonyme (2 à 32 lettres, chiffres, espaces, `_ . -` ; un email est
  refusé) et jamais rien d'autre du joueur. Les pseudonymes ne sont **pas authentifiés** : n'importe qui peut soumettre
  sous n'importe quel nom, et soumettre le premier un run publié sous le sien.
- **Fantômes sur cibles sémantiques** : un fantôme montre des lieux, des actions sur des ids et l'inventaire, jamais
  une traînée de pixels ; il est désactivé la première fois qu'une catégorie est jouée.

## Accessibilité et équité

Une catégorie déclare ses entrées (souris, tactile, clavier, manette, macros). Une option d'accessibilité n'est
**jamais une triche implicite** : la vitesse et la taille du texte, la réduction des animations et la police lisible
ne changent rien au temps de jeu (une réplique coûte le même temps logique à toutes les vitesses), et les cibles du
clavier et du lecteur d'écran sont les mêmes actions. Une catégorie qui interdit une entrée le dit ; les entrées
utilisées par un run sont déclarées par le client (sa parole, comme le RTA).

## Limites

- **Intégrité n'est pas authenticité** : la chaîne prouve qu'un fichier n'a pas été modifié après son scellement, pas
  que le client a été honnête ; un client peut la recalculer. Pauses, menus, sauvegardes, RTA et entrées utilisées sont
  la parole du client.
- **`replay-valid` admet les runs assistés par outil** : un run dont un script ou le solveur a choisi les entrées se
  rejoue valide (le run de référence versionné est la route du solveur), tout comme un run repris après un crash (les
  entrées perdues après son dernier chunk ne sont pas dans son temps). Seuls un témoin ou un modérateur les écartent.
- **La graine d'une catégorie à graine aléatoire est le choix du client** : un joueur peut chercher hors ligne une
  graine facile. Les graines Mystery et Daily, données par un serveur, sont la réponse de la 4.1.15.
- Pas en 4.1.14 : le témoin en direct (`server-witnessed`), le rejeu par version épinglée dans le worker, un stockage
  SQL des runs, le montage de `/v1/runs` dans `bridge/src/server.ts`, l'e2e multi-navigateur (`npm run e2e:speedrun`)
  en CI, de vraies sessions OBS et LiveSplit et des tests terrain par des speedrunners (passes humaines).
