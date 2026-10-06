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

Une exception, choisie par le mainteneur (D14) : **la 4.1.1 ajoute** (l'entrée `web-scumm/reality`, le `reality` du
contenu, celui de la sauvegarde, l'entrée de session d'un signal, l'argument `reality` du `solve` du MCP), ce qui
serait une mineure. La lignée 4.1.x est celle où le projet reste jusqu'à la 4.2, la version finale. Chaque ajout est
optionnel, et rien de la 4.1.0 ne change. La 4.1.2 ajoute de la même façon (des champs optionnels sur
`RealityClientOptions`, `ExternalEntry` et les routes du Bridge, un résultat `mismatch`, un code de lint, deux commandes
du Bridge) : la même exception, rien de la 4.1.1 ne change. La 4.1.4 ajoute `destroy`, `onError`, `beforeSave` et
`onLoad` sur `Engine`, et `destroy` sur `App` : la même encore. La 4.1.5 ajoute `sessions` sur `Engine`, `camera` et
`walker` sur la vue de pièce, et ne déplace que des membres `@internal` : la même encore. La 4.1.6 ajoute deux
commandes à la ligne de commande, un champ `optional` aux vérifications de doctor et `tools/vite/plugins.ts`, et ne
change aucune API : la même encore.

Suivies : la dernière mineure de la majeure en cours reçoit les correctifs ; la mineure précédente reçoit les
correctifs de sécurité trois mois après la sortie de la suivante. La lignée 3.x s'est terminée avec la 3.9 ; ses jeux
passent en 4.0 avec `web-scumm migrate` (rien à réécrire pour un jeu déjà en schéma 3).

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
