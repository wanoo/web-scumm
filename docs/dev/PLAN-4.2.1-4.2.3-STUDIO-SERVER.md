# web-scumm 4.2.1 → 4.2.3 « Studio Server » : un jeu commun, édité en direct par plusieurs développeurs

> **Révision 3.** Numérotation et nom décidés par le mainteneur (D40) : les trois étapes sont **4.2.1 « Shared
> Floor »**, **4.2.2** et **4.2.3**. Révision 2 : le plan a été vérifié contre `origin/main` (`a0ce19d`, merge de la release 4.2.0) le 17 octobre 2026.
> Il intègre la relecture du mainteneur du même jour, puis une relecture automatisée en second contexte : un P0 sur la
> reprise après panne et douze P1, tous repris au §9.
> **Source normative.** C'est ce fichier, dans Git, depuis la PR de cadrage `docs/43-plan` (#127). Toute copie hors du
> dépôt n'en est qu'un reflet.
> **Base.** `v4.2.0`, commit `a0ce19dc67e1b5844b43bdb5a79edb94ca771354`.
> **Nature.** Une nouvelle surface produit : un serveur d'édition partagé. Le moteur, le DSL gelé (D28) et le Bridge ne
> changent pas de sens. Le format de sauvegarde ne change pas sans l'ADR 0026 (P4).

## 1. Contexte

Aujourd'hui, le Studio est un outil d'auteur **mono-utilisateur**, servi par le serveur de dev Vite. La vérité vit dans
les fichiers de `games/<id>/`, versionnés dans Git.

Le mainteneur veut **une plateforme où plusieurs développeurs se connectent au même serveur, en même temps**. Chacun
travaille sur un pan du scénario, et le serveur **assemble et compile** le travail commun. Sa demande du 17 octobre :
« j'aimerais bien une plateforme où plusieurs développeurs peuvent se connecter pour bosser des pans du scénario […]
bosser à plusieurs en même temps sur un même serveur et compiler un travail à plusieurs ».

Il a écarté deux autres formes :
- une proposition « git-native » (un Studio local par personne, des PR), jugée hors sujet ;
- des espaces personnels, au profit d'**une seule copie du jeu, partagée en direct**, avec des verrous explicites et des
  builds figés.

**Condition de réussite.** On doit pouvoir affirmer : **aucune modification confirmée n'est perdue, et chacun sait
exactement quelle version il regarde.**

### 1.1 Constats vérifiés contre le code (`a0ce19d`)

**Écrivains.** Le Studio n'a pas un seul point d'entrée des écritures, mais une dizaine :

- `serial` (`tools/studio/core.ts:176-182`) est une chaîne de promesses propre à un processus.
- `tools/studio/assets.ts:297-302` tient **sa propre** file. `uploadSheet` (`:527`) écrit en `:571`, `:616`, `:660`
  et `:683`, et supprime en `:638` et `:681`. `prepare` lance `npm run assets` (`:688`). Une partie des écritures
  sort de `games/` et va dans `public/assets` (`:294`).
- `tools/mcp/server.ts:18` (`npm run mcp`) crée un second `createStudio`, dans un autre processus, avec sa propre file
  et sa propre pile d'undo. `studio-apply` fait de même.
- Des outils d'auteur écrivent directement :
  - `tools/ids.ts:85,94,118,120` ;
  - `tools/i18n.ts:39,44-45` (la locale de base et la cible ensemble) ;
  - `tools/voices.ts:83` ;
  - `tools/pages/import-layout.ts:142` ;
  - `tools/pages/storyboard.ts:356` ;
  - `tools/provenance.ts:55` ;
  - `tools/assets.py:216` (`assets.gen.json`) ;
  - `tools/talk-apply.py:13` et `cut-sheet.py` (`art/`).
- La route `POST /__layout/<room>` (`tools/vite/plugins.ts:33`) est authentifiée par `authorizeStudioRequest`
  (`:34`). Elle écrit pourtant le layout (`:57`) sans file, sans validation et sans undo.
- `core.ts:553` écrit `storyboard.md`.
- Les agents et les éditeurs de texte qui écrivent directement les fichiers font partie du flux documenté
  (`AGENTS.md:70-74`, `tools/studio/plugin.ts:197`).

**Garde de validation.**

- `guarded` (`core.ts:322-339`) annule en 422 une écriture qui ajoute des erreurs, mais seuls `setValue` (`:313`) et
  `setLayout` (`:408`) l'appellent. Elle valide deux fois par écriture (`:323`, `:326`).
- La validation lit le disque :
  - elle importe `index.ts` du jeu (`core.ts:186`) et les mini-jeux du moteur depuis la racine (`:627`) ;
  - elle lit les layouts « as it is on disk » (`:575`) ;
  - `tsxImport` crée un namespace neuf à chaque appel (`:87-91`) ;
  - `importInChild` (`:97`) existe déjà : un processus enfant qui ne renvoie que des données.

**Écritures multi-fichiers, durabilité, undo.**

- `addEntity` écrit la salle (`core.ts:463`) puis le layout (`:470`) : deux écritures et deux entrées d'undo.
- `writeAtomic` (`core.ts:231-240`) écrit un temporaire `.<pid>.tmp` puis le renomme, sans fsync. `null` supprime le
  fichier (`:232`). Les notes, le storyboard et les assets passent par `writeFileSync`.
- La pile d'undo est globale et plafonnée à 200 entrées (`core.ts:228-249`). `step` lève 409 si le fichier a changé
  (`:274`). Les notes et le storyboard n'y entrent pas (`:487`, `:512-539`).
- Le Studio ne fait aucun autosave Git : rien de tel dans `tools/studio/`.

**Identité, diffusion.**

- `tools/studio/security.ts` vérifie l'hôte et l'origine. En LAN, un jeton **unique pour tous** (`:68-86`).
- `GET /__studio/api/events` (`tools/studio/plugin.ts:245-258`) émet `{type:'changed', file}` depuis un `fs.watch`
  récursif (`:198-216`). Le watcher réagit aussi aux propres écritures du Studio. Ces événements ne portent ni auteur,
  ni révision, ni curseur de reprise.

**Jeu jouable et sauvegardes.**

- `src/main.ts:4` importe `@game`, que `vite.config.ts:159` résout vers `games/<GAME>/index.ts`.
- Les iframes Play (`src/studio/play.ts:26`) et Rooms (`src/studio/rooms-bridge.ts:43`) se rechargent par le
  rechargement complet de Vite. La page Studio le refuse (`src/studio/main.ts:36-40`) et suit le SSE.
- L'enveloppe V4 (`src/engine/core/save.ts:73-81`) est un `z.strictObject`. Elle porte `gameId`, `gameSaveVersion`,
  `savedAt`, `state` et `variant` (dont `variant.hash`, `src/engine/core/remix/story.ts:40`).
- Les sauvegardes n'ont **aucune empreinte de contenu** :
  - `GameFingerprint` (`src/engine/core/fingerprint.ts:21-26`) n'y entre pas ;
  - le chargement élague les items, salles et acteurs inconnus au lieu de refuser (`save.ts:209-235`) ;
  - le format de sauvegarde est une surface stabilisée (`docs/dev/DSL-STABILITY.md:41`).

**Ids et provenance.**

- Les répliques ne reçoivent un id stable qu'avec `ids --lines` (`src/engine/core/content-ids.ts:137-144`).
- Les clés d'entité ne sont uniques que par salle (`core.ts:442`).
- La provenance IR (`src/engine/core/ir.ts:32-35`, `provenanceOf` `:505`) n'a pas d'entrée pour un id écrit par du
  code (`:500-502`).

**Bridge.**

- Les baux de maintenance (`bridge/src/maintenance.ts`, migration `0005`) prennent l'heure de la base et refusent au
  lieu d'attendre.
- Sur Postgres, un verrou consultatif accompagne le bail (`maintenance.ts:7-8`).
- Il n'y a **aucun jeton de fencing**, et les écritures ordinaires ne vérifient pas le bail en SQL.
- Biscuit : `bridge/src/biscuit.ts`.

**Décisions en vigueur.**

- D17 (`DECISIONS.md:22`) livre le joueur en SSE plus une lecture HTTP par curseur. D23 (`:30`) restreint le « no
  WebSocket » au Bridge et à la PWA, et admet un WebSocket local. D17 ne gouverne donc pas le Studio.
- La règle 10 de la charte (`CHARTER.md:40-42`, « no realtime scripting ») porte sur le contenu des jeux.
- L'ADR 0002 dit que `games/` ne contient que des données. C'est une convention : les fichiers de contenu sont des
  modules TypeScript, et valider ou compiler les **exécute**.

**Conséquence.** Le socle partagé doit d'abord **faire converger toutes les écritures** vers une seule API
transactionnelle, puis rendre l'arbre du jeu inaccessible en écriture à tout le reste. C'est un prérequis, pas un
détail.

## 2. Verdict et positionnement

- **Après 4.2.0 stable**, publiée le 16 octobre (D38). Les treize passes humaines de 4.2 restent ouvertes, et ce
  chantier ne les bloque pas.
- **Une seule copie, partagée en direct.** Git reste la persistance et l'historique sous le capot.
- **Les CRDT et la co-édition caractère par caractère sont reportés.** Le verrou par pan rend l'édition simultanée sûre
  sans eux.
- **Trois étapes**, publiables séparément (§5).
- **Deux modes, un seul noyau d'opérations.**
  - **Mode serveur** : l'arbre du jeu appartient au serveur. Aucune écriture hors de l'API n'est admise. Une écriture
    étrangère détectée met le projet en maintenance.
  - **Mode local** (`npm run dev`) : le flux actuel continue. Un agent, un éditeur ou `git checkout` peuvent écrire
    les fichiers. Le noyau **adopte** ces changements comme une révision externe (P6) au lieu de les refuser.

## 3. Principes structurants

### P1. La transaction est l'unité de modification

- **Une opération** porte :
  - un identifiant fourni par le client ;
  - l'auteur ;
  - les pans revendiqués, avec leurs jetons de fencing ;
  - pour chaque fichier touché, la révision de ce fichier vue par le client ;
  - une liste d'effets typés : créer, remplacer ou supprimer un fichier, ou faire une édition structurée qui se
    résout en contenu.
- **Une file par projet**, tenue par le seul processus serveur (P8). Elle remplace les files de `core.ts` et
  d'`assets.ts`.
- **Application**, dans la file :
  1. **Préparer.** Calculer le contenu après de chaque fichier. Ce contenu va dans un **magasin de blobs adressé par
     contenu** (`.studio/blobs/<sha256>`), avec fsync. Le contenu avant y est déjà, puisque chaque état confirmé y est
     stocké. Les binaires ne passent donc jamais par le journal. Un fichier absent est représenté par une sentinelle
     `absent`.
  2. **Valider** l'état final (P3).
  3. **Point de linéarisation.** Vérifier que les jetons de fencing sont courants (P2) et que la révision de chaque
     fichier touché n'a pas bougé (sinon 409). Écrire ensuite l'**intention** au journal : l'id d'opération, la
     révision cible, et pour chaque fichier le chemin, le hash avant et le hash après (ou `absent`). Faire un fsync.
     Une fois journalisée, l'opération **se termine même si un bail expire ensuite**.
  4. **Appliquer**, fichier par fichier :
     - écrire un temporaire, faire un fsync, le renommer, puis faire un fsync du répertoire ;
     - créer d'abord les répertoires nouveaux, avec un fsync de leurs parents ;
     - pour une suppression : `unlink`, puis fsync du répertoire.
  5. **Confirmer.** Écrire la révision, le résultat et l'association fichier → révision, puis faire un fsync.
  6. **Répondre et diffuser.**
- **Reprise au démarrage, toujours vers l'avant.** Une intention journalisée a déjà été validée. On la reprend donc
  fichier par fichier :
  - si le fichier est à son hash après, il est déjà appliqué ;
  - s'il est à son hash avant, on l'applique depuis le blob après ;
  - on confirme ensuite.

  Un fichier qui ne correspond à aucun des deux hashes met le projet en **maintenance**. On ne devine pas.
- **Échec en cours de processus** (par exemple ENOSPC au deuxième renommage) : on restaure les fichiers déjà renommés
  depuis leurs blobs avant, puis on marque l'intention `aborted`. Si la restauration échoue elle aussi, le projet passe
  en maintenance.
- **Temporaires abandonnés.** Au démarrage, on supprime les `*.tmp` restants, après avoir journalisé leur liste.

### P2. Chaque fichier a un seul pan d'écriture

- **Le propriétaire est déterminé par le fichier**, pas par la provenance IR, qui ne couvre pas les ids écrits par du
  code. La carte des pans est générée et testée. **Chaque fichier de `games/<id>/` appartient à exactement un pan,
  sinon la génération échoue.** Pour le jeu d'exemple :

| Pan | Fichiers |
|---|---|
| `room:<id>` | `rooms/<id>.ts`, `layout/<id>.json` |
| `game` · `items` · `cast` · `rules` | `game.ts` · `items.ts` · `cast.ts` · `rules.ts`, chacun le sien |
| `story` | `storyboard.json`, `storyboard.md`, `STORY.md`, `prompts.md` |
| `lang:<code>` | `locales/<code>.json` |
| `voices` | `voices.json` (un fichier indexé par langue, `core.ts:600-611`, donc un seul pan tant qu'il n'est pas découpé) |
| `assets` | `art/`, `audio/`, `assets.gen.json`, `talk-kits.json`, `provenance.json`, `provenance.lock.json`, et ce qu'`assets` écrit dans `public/assets` |
| `notes` | `notes.json` (créé à la demande) |
| `meta` | `index.ts`, `site.json`, `e2e.mjs`, `ending.config.example.ts`, `ids.paths.json`, `ids.migration.json` |
| `playtests` | `playtests/` |

- **Les regroupements de la carte** (personnage, énigme, chapitre, à l'étape 3) ne font que **référencer** des
  éléments. Ils ne verrouillent rien.
- **Une opération multi-pans** revendique tous ses pans d'un coup, dans un ordre fixe. Si un seul est tenu par
  quelqu'un d'autre, c'est un refus immédiat (423), sans attente et sans acquisition partielle. C'est le cas de
  `i18n`, qui écrit la base et la cible, et d'un objet créé dans une salle puis référencé dans une autre.
- **Mode exclusif** pour les opérations qui touchent tout le jeu (`ids`, une migration, `prepare` des assets). Elles
  prennent un **bail de projet exclusif**. Il n'est accordé que si aucun pan n'est tenu, et il bloque les nouvelles
  prises pendant sa durée. C'est le motif `exclusive`/`serving` de la migration Bridge `0005`.
- **Baux et fencing.**
  - Les baux sont pris, renouvelés et repris **par la file elle-même**, comme des opérations. Ils sont donc ordonnés
    avec les écritures, et l'heure vient du store (motif `bridge/src/maintenance.ts`).
  - Valeurs initiales : **TTL de 120 s**, renouvelé par le battement de présence (**30 s**). Ce sont des paramètres de
    projet.
  - Chaque prise incrémente un **jeton de fencing** monotone par pan, vérifié au point de linéarisation (P1, étape 3).
    Une requête de l'ancien détenteur, même déjà en vol, est refusée en 423 après expiration ou reprise.
  - Le client garde son brouillon refusé localement : il peut le copier ou le réessayer après une nouvelle prise.
  - Une reprise par un `owner` est une opération journalisée, qui nomme l'ancien détenteur.

### P3. Une garde de validation unifiée, sur l'état final, hors du processus serveur

- **Toutes les écritures** passent par la même garde : validate, plus le contrôle propre au type (parse, schéma, id).
  Elle juge l'**état final de la transaction**. « Créer l'objet + le référencer ailleurs » passe en une transaction.
- **Règle de `guarded`, conservée** : une transaction qui **ajoute** des erreurs est refusée en 422, avec la liste. Les
  erreurs déjà présentes ne bloquent pas, ce qui permet de réparer progressivement. Les erreurs de la révision courante
  sont mises en cache : **une seule validation par opération**, au lieu de deux.
- **L'état préparé est un vrai répertoire**, pas des fichiers isolés. C'est une copie du jeu par liens physiques, où
  les fichiers touchés sont remplacés, placée dans un espace qui résout `@engine` et les mini-jeux comme la racine.
  validate y lit tout depuis le disque, comme aujourd'hui.
- **validate s'exécute dans un processus enfant** (`importInChild`, `core.ts:97`, généralisé), pour deux raisons :
  - un long serveur ne cumule pas les namespaces de `tsxImport` ;
  - le code de contenu ne voit pas les secrets du serveur (§4).
- **Débit.** Le temps par opération est mesuré à l'étape 1 sur le jeu d'exemple : préparation, validation et
  application. Le seuil est écrit avant la release de l'étape, au p95. Le solveur et les playtests restent hors de la
  garde synchrone, et alimentent la santé par révision (P5).

### P4. La prévisualisation commune est un chantier explicite

`src/main.ts:4` importe `@game` statiquement. Diffuser des événements ne suffit pas à mettre à jour un jeu jouable.

- **Étape 1.** Play joue l'état local du serveur, comme aujourd'hui, mais il est **étiqueté** : « révision N au
  chargement ». Il est marqué *périmé* dès qu'une révision plus récente existe, et ne se recharge jamais seul.
- **Étape 2.** Le serveur produit une **prévisualisation par révision** : un build du jeu dans un répertoire isolé,
  immuable une fois produit, servi sous `/preview/<rev>/`. Si plusieurs révisions arrivent pendant un build, seule la
  dernière est construite. La prévisualisation affiche sa révision.
- **Seuil.** Au plus **5 s** entre la confirmation d'une opération et sa prévisualisation, sur le jeu d'exemple. C'est
  une cible : le seuil définitif est **écrit à partir de la mesure, avant la release de l'étape 2**.
- **Une partie ouverte n'est jamais rechargée en silence.** À l'annonce « révision N disponible », le joueur choisit
  entre **Reprendre** (si compatible), **Redémarrer** ou **Rester** sur sa révision, affichée en clair.
- **Sauvegardes et révisions**, tranché dans l'**ADR 0026** (étape 2) :
  - **Par défaut, l'enveloppe ne change pas** : elle est en `strictObject`, donc un champ nouveau ferait refuser les
    sauvegardes écrites par une prévisualisation 4.2.x par un lecteur 4.2.0 hors ligne. La prévisualisation garde, **à côté** de chaque emplacement,
    l'empreinte `GameFingerprint.logic` et la révision où il a été écrit.
  - Toutes les révisions partagent une origine, donc IndexedDB. Charger un emplacement écrit à une autre révision
    **passe toujours** par l'invite.
  - **« Compatible »** veut dire : empreinte logique identique. Sinon, l'invite propose une **reprise à risque** et
    liste ce que l'élagage de `parseSave` retirerait. Le choix par défaut est Redémarrer.
  - Changer l'enveloppe elle-même reste possible, mais seulement par la porte de stabilité
    (`docs/dev/DSL-STABILITY.md`), avec sa migration.

### P5. Tout porte une révision

- **Le compteur de révision** est monotone par projet et incrémenté par chaque opération confirmée. Il est associé à
  une **époque de projet** (identifiant aléatoire à la création), pour qu'un store restauré ou perdu ne réutilise
  jamais un numéro. Le Studio affiche « révision 412 » en permanence.
- **Chaque fichier garde sa dernière révision** : c'est la base du 409 de P1. Une écriture ailleurs dans le projet ne
  rend donc pas les autres pans périmés.
- **Diagnostics.** Validate, lint, solve et playtests tournent en tâche de fond. Chaque résultat porte **sa
  révision**. Un résultat plus ancien que la révision courante est affiché *périmé*.
- **Pas de coupable.** On parle de « **révision ayant introduit l'échec** », trouvée par bissection sur les snapshots,
  jamais d'auteur fautif : une incompatibilité peut venir de deux modifications raisonnables.
- **Snapshots.** Un snapshot est pris **à une frontière d'opération**, sans bloquer la file. On copie l'association
  fichier → blob de la révision ; les blobs sont immuables, puis matérialisés par liens physiques dans un répertoire
  isolé. La compilation se fait là.
- **Manifeste de build.** Il identifie :
  - l'époque et la révision ;
  - le hash de chaque fichier du jeu (sources et assets) ;
  - la version du moteur et le commit du dépôt ;
  - le lockfile ;
  - les diagnostics **de ce snapshot**.

### P6. Durabilité et entrée unique dès le socle

- **Idempotence.** Un identifiant d'opération rejoué renvoie le résultat enregistré, sans seconde application. Les ids
  sont ceux du **journal**, conservés aussi longtemps que lui : pas de table à durée limitée.
- **Confirmation** seulement après les fsync de P1.
- **Reconnexion.** Le client envoie l'époque et la dernière révision vue. Il reçoit la suite des opérations, ou une
  resynchronisation complète si l'époque diffère ou si la suite n'est plus disponible. On ne saute jamais un trou de
  révisions en silence.
- **Entrée unique.** Studio, assistant (`apply.ts`), MCP, outils d'auteur (TS et Python) et assets passent par l'API.
  - En mode serveur, MCP et CLI sont des clients authentifiés par un Biscuit atténué.
  - La route `POST /__layout` est retirée.
- **Changements externes.** On les détecte par **comparaison de hashes** avec l'état confirmé, jamais par les seuls
  événements `fs.watch`, qui réagissent aussi aux propres écritures du serveur.
  - En mode local, un changement externe est **adopté** comme une opération d'auteur `external`.
  - En mode serveur, il met le projet en maintenance.
- **Historique Git (nouveau).** L'autosave Git est l'historique lisible, pas la garantie :
  - un commit par lot de révisions, avec `Co-authored-by` ;
  - exécuté **sous la file**, avec son propre index (`GIT_INDEX_FILE`) ;
  - en mode serveur, aucun `git` ni hook externe sur l'arbre du serveur.

### P7. Transport : SSE et HTTP par curseur

D17 ne gouverne pas le Studio (D23). On reprend pourtant son motif, éprouvé dans le Bridge :
- **un flux SSE par projet** pour les révisions confirmées (id d'opération, révision, auteur, pans et fichiers
  touchés), les baux, la présence, les diagnostics et les builds ;
- **une lecture HTTP par curseur** (`GET /ops?epoch=…&after=<rev>`) qui donne les mêmes événements et sert à la
  reprise ;
- **la présence** passe par un battement HTTP, qui renouvelle aussi les baux.

Un WebSocket ne serait envisagé que si une mesure montre que SSE et HTTP ne tiennent pas.

### P8. Un seul processus écrivain par projet

- Le serveur prend un **bail de service par projet** dans le store, avec fencing, avant d'ouvrir la file.
- Une seconde instance (déploiement progressif, redémarrage en double) est refusée, et ses requêtes renvoient 503.
- Un déploiement arrête l'ancienne instance avant que la nouvelle ne prenne le bail.

## 4. Sécurité et identité

- **Comptes** locaux au serveur : mot de passe argon2id, ou lien d'invitation à usage unique. Pas de fournisseur
  externe à l'étape 1.
- **Sessions** : cookie `HttpOnly`, `Secure`, `SameSite=Strict`. La vérification d'origine de `security.ts` est
  conservée.
- **Rôles** :
  - `owner` : membres, reprise de baux, builds publics ;
  - `dev` : écrit sur les pans qu'il tient ;
  - `reviewer` : lit, joue, commente.
- **Jetons de CLI et de MCP** : des Biscuit atténués au projet et au rôle, qui expirent et se révoquent (motif
  `bridge/src/biscuit.ts`).
- **Le code de contenu s'exécute** quand on valide ou compile (§1.1, ADR 0002). Sans isolation, un `dev` pourrait lire
  la base, les hashes de mots de passe et la clé racine Biscuit, puis forger un jeton `owner`. Les rôles ne voudraient
  alors plus rien dire. Donc :
  - validate, solve, playtests et build tournent dans des **processus enfants sans secrets** (environnement vidé),
    sous un **utilisateur système distinct**, sans accès en lecture au store, à la clé racine ni aux sessions ;
  - leur accès réseau est coupé quand la plateforme le permet (permissions Node, ou conteneur) ;
  - le modèle de menaces dit ce qui reste : un membre peut faire tourner du code sur la machine de build. Les membres
    sont donc des personnes de confiance.
- **Le modèle de menaces** `docs/dev/threat-models/studio-server.md` est écrit à l'étape 1, avant toute exposition
  réseau. Il couvre aussi :
  - l'upload d'assets : taille, type, décodage dans un processus limité ;
  - le traversal de chemins ;
  - le déni de service par les builds ;
  - les secrets.

## 5. Découpage

Chaque étape est publiée seule, avec ses gates automatiques. Ses passes humaines sont des issues `field-pass`,
**signalées et non bloquantes** (D12).

### Étape 0 : cadrage (cette PR) et maquettes

- Ce plan, l'ADR 0025, D39 et D40.
- Des **maquettes avec les vrais assets** du jeu d'exemple, validées par le mainteneur **avant tout code** :
  - le bandeau de révision ;
  - la présence ;
  - un pan tenu ou libre, et le refus 423 avec le brouillon gardé ;
  - le conflit 409 ;
  - le mode exclusif ;
  - la santé avec l'état périmé ;
  - l'écran Builds ;
  - Play étiqueté, et l'invite « révision N disponible ».

### Étape 1 : 4.2.1 « Shared Floor », socle partagé

- **Découpage neutre** (première PR) : le noyau d'opérations est extrait de `core.ts`, `source.ts`, `assets.ts` et
  `apply.ts`, avec des effets typés. Le comportement ne change pas.
- **Noyau transactionnel** :
  - magasin de blobs, journal, reprise vers l'avant (P1) ;
  - garde unifiée en processus enfant (P3) ;
  - révisions par fichier et époque (P5).
- **`studio-server/`** : serveur Node qui sert le Studio buildé et l'API, avec bail de service (P8). `--local`
  conserve le flux actuel et l'adoption des changements externes.
- **Store de métadonnées** SQLite (local) ou Postgres, avec migrations, sur le motif de `bridge/` : projets, comptes,
  sessions, baux et fencing, journal, révisions.
- **Pans et baux** (P2) : carte générée, baux par la file, mode exclusif.
- **SSE et lecture par curseur** (P7), reconnexion et resynchronisation (P6).
- **Convergence des entrées** : MCP, assistant, outils TS et Python. La route `__layout` est retirée.
- **Client** :
  - `src/studio/api.ts` : ids d'opération, jetons, gestion des 409 et 423, révision vue ;
  - `src/studio/main.ts` : flux de révisions ;
  - bandeau de révision, présence, Play étiqueté.
- **Sécurité** : modèle de menaces, isolation des processus enfants (§4).
- **Docs** `docs/en|fr` : Studio Server, et UPGRADING pour le mode local.

**Hors étape 1** : la prévisualisation par révision, l'undo personnel (désactivé en mode serveur, avec un message
clair), les builds et la carte.

**Critères de sortie** :
- **Aucune écriture hors noyau.** Un contrôle statique cherche, hors du noyau, toute écriture vers `games/` ou
  `public/assets` : `writeFile*`, `copyFile*`, `rm`, `unlink`, `rename`, `open(…'w')` Python, et processus lancés.
  Un test bout-à-bout lance chaque outil d'auteur contre un serveur. Il vérifie que l'arbre ne change que par le
  journal.
- Les tests de concurrence et de pannes du §6 sont verts.
- Le seuil de débit est écrit (P3).
- La passe humaine est ouverte en issue `field-pass` (deux ou trois navigateurs, une coupure réseau volontaire).

### Étape 2 : 4.2.2, atelier jouable

- Prévisualisation par révision et invite de partie ouverte (P4), avec l'ADR 0026.
- Santé par révision, état périmé, bissection (P5).
- **Undo personnel** : il émet l'opération inverse. Il est refusé en 409 si un autre a touché le fichier depuis, et
  en 423 si le pan n'est plus tenu.
- **Builds immuables** : snapshot, compilation isolée, manifeste, `/play/<n>`. Le **dernier build vert** est toujours
  servi.

**Critères de sortie** :
- le seuil de 5 s est mesuré, et le seuil définitif écrit ;
- un diagnostic périmé s'affiche bien comme tel ;
- le manifeste correspond octet pour octet au snapshot ;
- la passe humaine est ouverte.

### Étape 3 : 4.2.3, coordination avancée

- **Pans transverses** (personnage, énigme, chapitre) comme regroupements, et **carte du scénario**
  (`scenario.map.json`).
- **Commentaires ancrés** sur les ids stables, avec ids de répliques généralisés (`ids --lines`).
- **Diff sémantique** entre révisions et entre builds, avec captures.
- **Intégrations** :
  - push vers GitHub ;
  - déploiement de référence sur Clever Cloud (FS bucket et Postgres, P8 pour les déploiements) ;
  - packaging et signature du serveur dans les artefacts de release.

## 6. Tests

**Concurrence**, avec trois clients simulés :
- une transaction multi-fichiers s'applique entière ou pas du tout ;
- un pan tenu par un autre donne 423 ;
- un fichier dont la révision a bougé donne 409, et une écriture sur un autre pan n'en provoque pas ;
- une opération multi-pans prend tous ses baux ou aucun ;
- le mode exclusif est refusé tant qu'un pan est tenu ;
- dix clients en rafale ne perdent aucune écriture, et les sources restent parsables.

**Pannes**, par injection de fautes à chaque frontière de P1 (après les blobs, après l'intention, entre deux
renommages, avant la confirmation), puis redémarrage :
- la reprise vers l'avant aboutit ;
- un fichier qui ne correspond à aucun hash met le projet en maintenance ;
- un ENOSPC simulé en cours de processus restaure l'état avant ;
- une requête rejouée n'est appliquée qu'une fois ;
- un bail expiré ou repris refuse les requêtes en vol de l'ancien détenteur ;
- une opération déjà journalisée se termine malgré l'expiration de son bail ;
- après une coupure réseau, la reconnexion par curseur se fait sans trou ni doublon ;
- un changement d'époque force la resynchronisation ;
- une seconde instance est refusée (P8) ;
- un changement externe est adopté en mode local, et met le projet en maintenance en mode serveur.

**Invariant** (test de propriété) : toute opération confirmée au client se retrouve dans la révision suivante, dans le
journal, et à l'étape 2 dans le prochain build.

**Sécurité** : un contenu qui lit `process.env`, le fichier du store ou la clé racine pendant validate n'obtient rien.

**Qualité** : un set de mutation `studio-ops` pour le noyau, le journal et les baux, ainsi que les planchers de
couverture. Le set est mesuré dès l'étape 1 et devient bloquant à la release de l'étape.

## 7. Décisions

### D39 — « Studio Server »

Le mainteneur a décidé, le 17 octobre 2026 :
- une **plateforme partagée** : une seule copie du jeu, éditée en direct ;
- des verrous explicites et des builds figés ;
- des CRDT reportés ;
- un chantier mené après 4.2.0 stable ;
- les principes de ce plan (§3) et un découpage en trois étapes (§5).

Citation : « go to 4.3 », le 17 octobre. D40 fixe ensuite la numérotation.

### D40 — Trois patchs 4.2.x, et non une 4.3

Le 17 octobre, le mainteneur a fixé la numérotation et le nom de la première étape :
- **4.2.1 « Shared Floor »** (socle partagé) ;
- **4.2.2** (atelier jouable) ;
- **4.2.3** (coordination avancée).

Citations : « enfaite 4.2.1 4.2.2 4.2.3 » ; « Shared Floor » : « ok ».

Ce que cela implique :

- **Exception de version, sur le modèle de D14.** `docs/en|fr/SUPPORT.md` dit qu'un patch « fixes; it never changes a
  public name or a format ». Comme la ligne 4.1.x avant elle, la ligne **4.2.1 → 4.2.3 peut ajouter** : un outil, une
  commande, une route du Studio Server. Elle **ne peut pas changer ni retirer** un nom public ou un format de l'API
  publique (`src/engine` public, format de contenu, enveloppe de sauvegarde).
  - Si l'ADR 0026 conclut qu'il faut changer l'enveloppe, ce changement attend une 4.3.
  - La PR de release de 4.2.1 ajoute cette exception à SUPPORT, dans les deux langues.
- **Le mode local du Studio** reste compatible (§2). Ce qui change pour un auteur est décrit dans UPGRADING à chaque
  étape.
- **Passes humaines de 4.2** (D38). Elles se font sur un candidat 4.2.x et restent valables si leur surface ne change
  pas (D35, `field:carry`). Les surfaces Studio et site touchées par une étape exigent une nouvelle passe ; les autres
  sont reportées avec leur attestation.

### Numéros réservés

- **ADR 0025** : le Studio Server (P1 à P8). L'ADR 0022 reste réservé au DSL.
- **ADR 0026** : réservé aux sauvegardes face aux révisions (P4). Il n'est écrit qu'à l'étape 2, car un ADR n'est
  jamais vide.

## 8. Ce que ce plan ne fait pas

- Pas de co-édition caractère par caractère, ni de CRDT.
- Pas de nouvelle primitive DSL, ni de changement de sens du DSL gelé (D28).
- Pas de changement de l'enveloppe de sauvegarde sans l'ADR 0026 et la porte de stabilité.
- Pas de service hébergé par le projet : le serveur est auto-hébergé par une équipe.
- Pas de fournisseur d'identité externe à l'étape 1.
- Pas de changement du Bridge, à part la réutilisation de ses motifs.
- Pas de publication npm du serveur avant l'étape 3 (4.2.3).
- Pas de changement d'un nom public ni d'un format dans la ligne 4.2.x (D40).

## 9. Relectures

- **Mainteneur, 17 octobre, après la révision 2** : numérotation en 4.2.1, 4.2.2 et 4.2.3, nom « Shared Floor » (D40).
  Le fichier est renommé de `PLAN-4.3-STUDIO-SERVER.md` en `PLAN-4.2.1-4.2.3-STUDIO-SERVER.md`.

- **Mainteneur, 17 octobre**, sur la proposition précédente : les sept principes, le découpage en trois étapes et les
  tests de pannes.
- **Second contexte de lecture automatisé, 17 octobre**, sur la révision 1. Toutes les références du §1.1 ont été
  ouvertes : la plupart étaient exactes, et les imprécisions sont corrigées ci-dessus. Corrections apportées :
  - **P0** : la reprise ne pouvait pas revenir en arrière, puisque le journal n'avait que des hashes. Elle se fait
    maintenant vers l'avant, avec un magasin de blobs et une sentinelle `absent`, et les répertoires sont fsyncés.
  - **P1** :
    - la carte des pans n'était pas complète pour le jeu d'exemple : table du §P2, pan `voices` unique, mode
      exclusif ;
    - le 409 portait sur la révision du projet ; il porte maintenant sur celle de chaque fichier ;
    - le point de linéarisation était mal placé, et les baux ne passaient pas par la file ;
    - validate lit le disque : l'état préparé est un vrai répertoire, avec un processus enfant ;
    - les secrets étaient lisibles par le code de contenu ;
    - les changements externes en mode local n'étaient pas traités ;
    - aucun bail ne garantissait une instance unique (P8) ;
    - l'enveloppe de sauvegarde est en `strictObject`, et IndexedDB est partagée entre révisions ;
    - Play n'était pas étiqueté à l'étape 1 ;
    - la passe humaine était bloquante, contrairement à D12 ;
    - l'ADR 0025 et l'ADR 0026 se contredisaient.
  - **P2** :
    - l'idempotence s'appuie maintenant sur le journal ;
    - l'autosave Git est nouveau et passe sous la file ;
    - les pans globaux sont séparés ;
    - le propriétaire est déterminé par le fichier ;
    - le seuil de 5 s est une cible ;
    - les snapshots ne bloquent plus la file ;
    - une époque de projet est ajoutée ;
    - le contrôle des écrivains est élargi ;
    - le TTL et le battement sont fixés ;
    - le LOG passe en fragment `changes/`.
