# Suivi et stabilité

Ce que web-scumm promet à partir de la 4.0, et comment cela change.

## Ce qui est stable

L'API publique (`docs/fr/API.md`) : les entrées `web-scumm/content`, `/player`, `/minigames`, `/testing` et, depuis
la 4.1.1, `/reality`, le
schéma d'écriture (`schemaVersion: 3`), l'enveloppe des sauvegardes, les schémas des outils du Studio et du MCP, et la
commande `web-scumm`. Tout le reste de `src/engine` est interne : il peut changer à chaque release, et un jeu qui y
accède par l'alias `@engine/*` en prend le risque.

## Versions

Versionnage sémantique de l'API publique :

- un **correctif** (4.0.x) répare ; il ne change jamais un nom public ni un format ;
- une **mineure** (4.x) ajoute ; elle peut déprécier, jamais retirer ;
- une **majeure** (5.0) peut retirer ce qu'une mineure a déprécié, et dit comment passer dans `docs/fr/UPGRADING.md`.

**La lignée 4.1.x est l'exception, dite une fois (D14).** Depuis la 4.1.1 le projet reste en 4.1.x jusqu'à la 4.2, la
version finale, et une release 4.1.x peut *ajouter* : une entrée, un champ, une route, une commande, un hook ou un
sous-objet optionnels (le `web-scumm/reality` de la 4.1.1, les options du Bridge de la 4.1.2, `destroy` et les hooks
de la 4.1.4, `sessions`, `camera` et `walker` de la 4.1.5, les deux commandes de la 4.1.6). Ce qu'elle ne peut pas
faire est ce qu'un correctif ne peut pas faire non plus : changer ou retirer un nom public ou un format. Chaque ajout
est optionnel, rien de la 4.1.0 ne change, et un jeu ou un hôte écrit pour n'importe quelle 4.1.x tourne sur chaque
4.1.x suivante, **jusqu'à la 4.1.7**. `docs/fr/UPGRADING.md` a une section par release qui dit ce qu'un hôte doit
savoir, s'il y a quelque chose.

**À partir de la 4.1.8, la lignée 4.1.x est une lignée d'incubation (D18, 7 octobre 2026).** Aucun jeu de production
ne dépend du moteur (le jeu du mainteneur reste en 3.1.0, D8) : une release du programme `docs/dev/PROGRAM-4.1.md`
(4.1.8 à 4.1.15) peut casser un nom public ou un format quand le programme l'exige. Chaque rupture est listée sous
« Breaking » dans le CHANGELOG, livrée avec une migration des jeux fournis et des sauvegardes quand elles sont
concernées, et a sa section dans `docs/fr/UPGRADING.md` ; une surface dont les passes humaines ne sont pas faites est
marquée expérimentale ici. Le socle du DSL est stabilisé en 4.1.12 et gelé après la 4.1.15. **La 4.2.0 « Stable
World » rétablit le SemVer strict** : à partir d'elle, une mineure ajoute et une majeure retire, comme ci-dessus. Les
versions les plus risquées ont d'abord une release candidate (`4.1.8-rc.1`, une pré-release GitHub avec les mêmes
fichiers et les mêmes contrôles).

Suivies : la dernière mineure de la majeure en cours reçoit les correctifs ; la mineure précédente reçoit les
correctifs de sécurité trois mois après la sortie de la suivante. La lignée 3.x s'est terminée avec la 3.9 ; ses jeux
passent en 4.0 avec `web-scumm migrate` (rien à réécrire pour un jeu déjà en schéma 3).

## Matrice de support

Ce que les gates automatiques exécutent à chaque changement, et ce que seules des personnes vérifient
(`docs/fr/FIELD.md`) :

| | Vérifié par la CI à chaque changement | Vérifié par des personnes (pas encore fait) |
|---|---|---|
| Joueur, téléphone | Chromium et WebKit à la taille d'un téléphone, tactile et clavier, hors ligne (Chromium), français | un vrai téléphone Android, un vrai iPhone, Safari hors ligne sur l'appareil |
| Joueur, bureau | Chromium, souris et clavier | — |
| Joueur, lecteur d'écran | axe-core sur chaque écran (pas une conformité WCAG) | une passe VoiceOver ou NVDA |
| Firefox | pas en CI | rien de promis |
| Node | 22.12 ou plus : 22 et 24 sur Ubuntu ; macOS pour l'usage quotidien du mainteneur | — |
| Windows | un job `windows-latest` à chaque changement (4.1.8) : `doctor`, `check` (types et suite unitaire), `build`, le serveur de production qui répond | `npm run dev` et le Studio sous Windows |
| Python | optionnel : les outils d'image et le pipeline audio, Pillow, NumPy, SciPy épinglés dans `requirements.txt` | — |
| Reality Bridge | Node 22.12+, e2e Chromium et WebKit, une contre-vérification Rust du protocole | un Bridge derrière HTTPS avec un vrai connecteur |
## Dépréciation

Un nom ou une option à retirer est d'abord **déprécié** dans une mineure : marqué `@deprecated` dans son type (les
éditeurs le barrent), listé dans `docs/fr/API.md` avec son remplaçant, et nommé dans la section « Deprecated » du
CHANGELOG. Il continue de marcher pour le reste de cette majeure, et disparaît à la suivante. Déprécié en 4.0 :
`RevealDef` (utiliser `EndingDef`).

## Sauvegardes

Une sauvegarde écrite par n'importe quelle release des lignées 3.x ou 4.x se charge dans toute 4.x suivante :
l'enveloppe est versionnée (schéma 3), les `migrations` du jeu portent ses ids, et `tests/save-v3.test.ts` charge une
sauvegarde figée de chaque release. Une sauvegarde plus récente que le jeu où on la charge est refusée, jamais lue à
moitié.

## Releases

Chaque release est construite depuis le commit que la CI a testé, porte ses licences dans l'archive, joint un manifeste
des assets, un SBOM, des sommes SHA-256 et une attestation de provenance, et n'est jamais remplacée une fois publiée
(`docs/fr/TOOLS.md`). Ce que seuls des gens et de vrais appareils vérifient est rapporté dans ses notes
(`docs/fr/FIELD.md`).
