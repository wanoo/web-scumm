# Installer depuis npm, une fois publié

**Le moteur n'est pas publié sur npm.** Le 23 octobre 2026, `npm view` répond `404 Not Found` pour `quest-n-click`,
`create-quest-n-click`, `quest-n-click-bridge`, `quest-n-click-connectors` et `quest-n-click-studio-server`. Tant que les
notes d'une release ne disent pas le contraire, installez depuis l'archive de la release :
[Installer depuis l'archive de la release](install.from-archive.md). Cette page dit comment savoir quand npm sera
prêt, et quelles commandes serviront alors.

<a name="what-you-get"></a>

## Ce que vous obtenez

Aujourd'hui : un moyen de vérifier, en une commande, si un paquet `quest-n-click` sur npm est bien celui du projet. Une
fois les paquets publiés : un projet de jeu créé et mis à jour avec les commandes habituelles de npm, sans URL
d'archive.

<a name="context-and-versions"></a>

## Contexte et versions

- Un **projet créé**, sur votre machine.
- Rien n'a jamais été publié sur npm, jusqu'à la 4.4.0 incluse. La 4.2.0 n'est partie que sur GitHub Releases (D38) :
  la publication demande la double authentification du mainteneur à chaque étape, et la 4.2.0 ne l'a pas attendue. Le
  README annonce la publication npm pour une release ultérieure ; aucune version n'est promise.
- D'ici la première publication, les noms sont seulement surveillés : un job du workflow de nuit (`npm-names`, jamais
  bloquant) vérifie que chaque nom, les actuels comme les anciens `web-scumm…`, est encore libre ou publié par le
  compte npm du mainteneur, et prévient sinon. Qu'un tiers prenne un nom avant est un risque accepté par le projet
  (D34).

> [!LIMIT id=npm-not-published]
> Ni `npm install quest-n-click`, ni `npx create-quest-n-click`, ni `npm install quest-n-click@<version>` ne marche
> aujourd'hui : npm répond 404. Un paquet sous l'un de ces noms qui apparaîtrait sur npm avant qu'une release
> l'annonce n'est pas celui du projet : ne l'installez pas.

<a name="prerequisites"></a>

## Prérequis

- Les [Prérequis](install.requirements.md) de tout projet de jeu : Node.js 22.12 ou plus récent, Python 3 pour les
  images.
- Une release dont les notes annoncent la publication sur npm.

<a name="where-to-run"></a>

## Où lancer les commandes

Sur votre machine, depuis le dossier qui contiendra le projet ; puis dans le projet créé.

<a name="steps"></a>

## Étapes

<!-- step: check-owner -->
1. Vérifiez que le paquet existe et qu'il est celui du projet. Son mainteneur doit être `wanoo` et son dépôt
   `github.com/Quest-n-Click/quest-n-click` :

   ```bash
   # n'importe où
   npm view quest-n-click maintainers repository.url
   ```

   Aujourd'hui, cela affiche `npm error 404 Not Found` : arrêtez-vous là et prenez
   l'[archive de la release](install.from-archive.md).

<!-- step: create-from-npm -->
2. Créez le projet. Les deux commandes font la même chose (`create-quest-n-click` lance `quest-n-click create` depuis le
   moteur dont il dépend) :

   ```bash
   # dans le dossier qui contiendra le projet
   npx create-quest-n-click my-game "Mon jeu"     # ou : npx quest-n-click create my-game "Mon jeu"
   ```

   Sans `--engine`, `create` écrit la dépendance `"quest-n-click": "^<version>"`, que npm résout depuis le registre.

<!-- step: install-and-play -->
3. Installez, préparez les images et jouez, comme depuis l'archive :

   ```bash
   # depuis le dossier qui contient le projet, puis dedans
   cd my-game
   npm install
   python3 -m pip install -r node_modules/quest-n-click/requirements.txt
   npm run assets && npm run dev
   ```

<a name="expected-result"></a>

## Résultat attendu, et comment le vérifier

Une fois la publication faite, l'étape 1 affiche le mainteneur et le dépôt ; l'étape 2 se termine par
`my-game: "Mon jeu" created (quest-n-click ^<version>).` Un projet fait depuis une archive passe au registre avec
`npm install quest-n-click@<version>`, qui remplace l'URL de l'archive dans son `package.json` par une plage de
versions.

<a name="common-errors"></a>

## Erreurs fréquentes

| Symptôme | Cause | Correction |
|---|---|---|
| `npm error 404 Not Found - GET https://registry.npmjs.org/quest-n-click` | Pas encore publié | [Installer depuis l'archive de la release](install.from-archive.md) |
| `npm view` montre un autre mainteneur que `wanoo` | Un nom pris par un tiers | Ne l'installez pas ; signalez-le dans les issues du projet |

<a name="files-changed"></a>

## Fichiers ou données modifiés

L'étape 1 ne change rien. Les étapes 2 et 3 écrivent le même projet que [depuis l'archive](install.from-archive.md#files-changed) ;
seule la dépendance dans `package.json` diffère (une plage au lieu d'une URL).

<a name="recovery"></a>

## Reprise ou retour arrière

Un projet créé depuis npm revient à une archive avec `npm install <URL de l'archive>`, comme le décrit
[Mettre à jour](install.upgrade.md).

<a name="how-it-will-be-published"></a>

## Comment la publication se prépare

La procédure a été écrite en 4.1.20 et sera jouée par le mainteneur dans une release ultérieure ; le détail est dans
[Paquets npm](contribute.npm-packages.md). Ce sur quoi un utilisateur peut compter :

- **Une publication en étapes, approuvée par une personne.** Le run de release met chaque paquet en scène via l'OIDC
  de GitHub (trusted publishing, configuré en stage-only : la CI peut mettre en scène, jamais publier), et le
  mainteneur promeut chacun avec sa double authentification (`npm stage approve <id>`, ou sur npmjs.com). Une version
  du produit ne vient jamais d'une publication locale, qui ne porterait pas de provenance OIDC ; seule une version de
  réservation `0.0.0-bootstrap.0` le peut, une fois par paquet, pour le créer.
- **Des outils exacts.** La publication en étapes demande au moins npm 11.15.0 et Node 22.14.0. `release.yml` épingle
  les versions de l'étape de publication à l'identique, `NPM_PUBLISH_NODE: 22.23.3` et `NPM_PUBLISH_NPM: 11.21.0`, et un
  test refuse une plage. Node 22.23.3 livre npm 10.9.9 : l'étape installera donc elle-même npm 11.21.0. En 4.4.0,
  seuls les épinglages existent : l'étape de publication elle-même n'est pas encore écrite.
- **Les connecteurs ne sont pas déclarés dual-use.** La politique dual-use de npm vise les outils qui peuvent
  ressembler à un logiciel malveillant (test d'intrusion, recherche en sécurité, obfuscation) ; les connecteurs sont
  des serveurs qu'un jeu fait tourner (une façade SSH et Telnet, un webhook et un lecteur IMAP pour l'email, un
  vérificateur Open Badge), qui ne scannent, n'attaquent et ne cachent rien. Ils passent par la même publication en
  étapes et la même promotion à double authentification que les autres paquets. Si l'analyse de npm retient ou
  signale le paquet, il reçoit `"contentPolicy": { "class": "dual-use" }` et un fichier `DISCLOSURE`.

<a name="references"></a>

## Références

- [Installer depuis l'archive de la release](install.from-archive.md), [Référence du paquet](install.package.md)
- [Paquets npm](contribute.npm-packages.md) (la procédure du mainteneur), [Publier une release](contribute.releasing.md)
- La documentation de npm : [staged publishing](https://docs.npmjs.com/staged-publishing),
  [politique dual-use](https://docs.npmjs.com/policies/dual-use/)
- [`.github/workflows/nightly.yml`](../../.github/workflows/nightly.yml) (le job `npm-names`),
  [`.github/workflows/release.yml`](../../.github/workflows/release.yml) (les épinglages)
