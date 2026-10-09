# Preuve terrain : ce que seuls des gens et de vrais appareils vérifient

La machine vérifie une release à chaque push : le solveur, les navigateurs en CI, l'archive, les budgets. Sept
vérifications demandent une personne ou un vrai appareil. Elles sont rapportées dans les notes de chaque release, pas
bloquantes (D12) : une release dit combien ont été faites (`docs/dev/passes/<version>.md`, depuis
`docs/dev/passes/TEMPLATE.md`). Cette page dit comment faire chacune et quoi rapporter.

| # | Passe | Comment | À rapporter |
|---|---|---|---|
| 1 | Lecteur d'écran | `docs/dev/SCREEN-READER.md` : VoiceOver sur iOS ou TalkBack sur Android, une partie de l'écran titre à la première énigme résolue | la ligne de la fiche : appareil, OS, ce qui n'a pas pu être atteint ou n'a pas été lu |
| 2 | Safari hors ligne | `docs/dev/SAFARI-OFFLINE.md` : première visite en ligne, mode avion, un lieu jamais visité, un rechargement | la ligne : versions d'iOS et de Safari, l'étape qui a échoué |
| 3 | Un vrai téléphone | la scène la plus lourde (le marché de référence, le jardin de la démo) sur un téléphone moyen de gamme, avec le compteur (`?fps`) | le FPS le plus bas vu (≥ 30 voulu), le téléphone |
| 4 | Testeurs | cinq personnes qui ne connaissent pas les énigmes, chacune sur son téléphone, sans aide | leurs fichiers de session (ci-dessous), puis `npm run verify:field` |
| 5 | Voix enregistrées | `npm run voices -- check --release` après l'enregistrement : répliques validées sur répliques avec un id | le compte, les répliques restantes |
| 6 | Écoute | chaque partition sur le haut-parleur d'un téléphone et au casque : les stems suivent le jeu, chaque pont une fois, rien de coupé, rien qui reste après le chargement d'une sauvegarde, une voix pendant un pont | la ligne, et chaque défaut avec son lieu et ce qui a été entendu |
| 7 | Tag signé | `git tag -s vX.Y.Z` avec la clé du mainteneur, `git tag -v` le montre | la ligne |

## Testeurs (passe 4)

1. Envoyer l'URL du jeu. Dire seulement : « joue comme tu veux ; quand tu t'arrêtes, fini ou pas, ouvre le menu pause
   et touche *Partager la session* ». N'expliquer aucune énigme, même sur demande : noter la question.
2. *Partager la session* fait un fichier avec les entrées depuis le début de la partie (ids et indices seulement, pas
   de texte du journal, pas de nom), la famille d'appareil (`ios`, `android` ou `desktop`, rien de plus fin) et les
   tapes manquées (une tape sur rien à côté d'une cible, par lieu et cible). Le testeur l'envoie comme il veut.
3. Déposer les fichiers dans `games/<id>/playtests/` (commité ; `npm run audit` le couvre), puis :
   - `npm run playtests -- --out=.cache/playtests` : temps de jeu par lieu, où les joueurs bloquent, indices montrés,
     où ils se sont arrêtés, tapes manquées, une heatmap sur le graphe d'énigmes ;
   - `npm run verify:field` : `verify:commercial`, puis cinq sessions qui se rejouent encore, trois jouées jusqu'au
     bout, deux familles d'appareils. Ces nombres sont les quotas d'une release testée par des joueurs ; un jeu peut en
     demander plus avec `npm run playtests -- --strict --require=N --require-completed=N --require-devices=N`.
4. Ce que montre le rapport devient du travail : un blocage est une énigme à mieux indiquer, une tape manquée une zone
   à élargir, un abandon un endroit à regarder. Les sessions restent : quand le contenu change elles peuvent ne plus se
   rejouer, et `--strict` dit lesquelles (les réenregistrer ou les supprimer).

## La fiche

Copier `docs/dev/passes/TEMPLATE.md` en `docs/dev/passes/<version>.md` avant le tag, remplir ce qui a été fait,
laisser « not done » là où rien ne l'a été. `scripts/release-notes.mjs` met le tableau dans les notes de release avec
« n of 7 done ».

## Le Field Kit (4.1.18)

Depuis la 4.1.18, une passe est un rapport JSON, plus une ligne éditée à la main : un fichier par passe, lié au
**candidate run** qu'il a essayé (son commit, son id de run et le SHA-256 de chaque fichier jugé), dans un dossier qui
garde aussi le `candidate-manifest.json` de ce run. Treize passes, chacune par un id stable : `bridge-postgres-https`,
`runs-real-players`, `run-resume-power-cycle`, `code-wheel-human`, `mystery-deployed`, `safari-ios-offline-update`,
`firefox-real-offline`, `phone-both-renderers`, `livesplit-obs`, `connectors-real-security`, `blind-playtesters`,
`voices-listening`, `archive-human-install`.

```sh
npm run field:init -- --release=4.1.18 --candidate=<run id>     # les treize rapports à not-run, dans .cache/field/4.1.18
npm run field:check -- --dir=.cache/field/4.1.18                # schéma, candidat, SHA-256 des preuves, recherche de fuites
npm run field:report -- --dir=.cache/field/4.1.18 --out=docs/dev/passes/4.1.18.md
npm run field:bundle -- --report=<report.json> --out=<bundle.tar.gz>   # ce que porte un ticket de reproduction
```

- **Quatre mots, jamais confondus** : `not-run`, `blocked`, `failed`, `passed`. Seul `passed` compte comme fait dans
  les notes de release, et seul `passed` peut lever le statut `experimental` d'une surface (D18). Une passe reste
  rapportée sans bloquer un tag 4.1.x (D12) ; `field:check --require=<id,…>` sert à la gate de la 4.2.
- **Ce que dit une passe essayée** : un opérateur (pseudonyme ou rôle, jamais une identité), son début et sa fin, sur
  quoi (OS, navigateur, appareil ou versions) et le scénario. `passed` liste ses preuves (le SHA-256 de chaque fichier
  est vérifié) et aucun échec ; `failed` dit ce qui a échoué ; `blocked` dit pourquoi dans `notes`.
- **Rien de privé** : le schéma refuse un champ qu'il ne nomme pas ; un rapport qui contient une clé, un token, une
  adresse email ou un bearer est refusé. Un bundle ne porte que les preuves listées par son rapport : les logs sont
  expurgés (adresses, bearers, valeurs de mot de passe, IP), une clé ou un token refuse le bundle, et son
  `bundle-manifest.json` donne le SHA-256 de chaque fichier. Les rapports et les petites preuves expurgées peuvent être
  committés sous `docs/dev/field/<version>/` (`npm run audit` les lit) ; les bundles restent des artefacts de run.
- **Autre commit, autre passe** : un rapport d'un autre candidate run, ou dont les empreintes ne sont pas celles du
  candidat, ne passe pas la vérification. Un correctif qui change le package rend caducs les rapports qu'il touche
  jusqu'à ce qu'ils soient refaits.
