# Paquets npm

Le moteur se livre en cinq paquets npm, empaquetés depuis les fichiers que git suit par
[`scripts/pack.mjs`](../../scripts/pack.mjs) et joints à chaque release GitHub. Cette page dit ce que contient chaque
paquet, comment les paquets sont vérifiés, et où en est leur publication sur le registre npm. Pour les installer en
tant qu'utilisateur : [Référence du paquet](install.package.md).

<a name="packages"></a>

## Les cinq paquets

| Paquet | Ce qu'il contient | Depuis |
|---|---|---|
| `quest-n-click` | Le moteur (`src/`), ses pages, ses outils, la commande `quest-n-click`, le modèle de jeu (`games/_template/`), et depuis la 4.5.0 son bundle de documentation `docs-bundle/` ; jamais un jeu de ce dépôt, un test, une page source de la doc ni un build | 3.9 |
| `create-quest-n-click` | `npx create-quest-n-click <dossier>`, qui lance `quest-n-click create` | 3.9 |
| `quest-n-click-bridge` | Le Reality Bridge de référence (un module, ses politiques) : un jeu qui n'en fait pas tourner ne l'installe jamais | 4.1.1 |
| `quest-n-click-connectors` | Les connecteurs du monde extérieur (un module, son worker MIME) : ceux d'un opérateur, jamais d'un jeu | 4.1.9 |
| `quest-n-click-studio-server` | Le Studio en ligne et son worker (deux commandes, la page du Studio) : celui d'un opérateur, à côté du moteur | 4.2.1 |

Le paquet du moteur ne prend que des chemins suivis sous ses racines (`src/`, `tools/`, `studio-server/`, une partie de
`bridge/src/`, `cli/`, `games/_template/`, les icônes et polices, `index.html`, `studio.html`, `vite.config.ts`,
`tsconfig.json`, `requirements.txt`, le verrou Python du worker, `LICENSE`). Un fichier non suivi sous l'une de ces
racines arrête l'empaquetage (« git add or commit them, or add them to .gitignore ») au lieu d'être oublié en silence.
Le Bridge, les connecteurs et le Studio Server portent leur verrou versionné en `npm-shrinkwrap.json` ; un verrou qui ne
correspond plus à son manifeste arrête l'empaquetage : `npm run locks` le refait (relire le diff, le commiter), et
`npm run locks -- --check` dit, sans réseau, si chaque verrou correspond encore.

De la 4.2.5 à la 4.2.x, chaque paquet était aussi empaqueté sous son ancien nom web-scumm, un alias aux mêmes fichiers
et à la même version (D47). La 4.3.0 n'empaquette plus que les nouveaux noms ; `npx quest-n-click migrate` fait quitter
les anciens à un jeu.

```sh
# dans le dépôt du moteur
npm run pack                                   # les cinq archives dans .cache/pack
node scripts/pack.mjs --out=.cache/pack --publish-dry-run   # et ce que `npm publish` enverrait pour chacune
```

<a name="how-it-is-checked"></a>

## Comment les paquets sont vérifiés

- **`npm run fresh-install`** (job de CI `fresh-install`, quand le plan dit qu'un paquet, le modèle ou un chemin
  d'écriture a changé) : empaquette le moteur, crée un jeu depuis le modèle empaqueté dans un dossier vide hors du
  dépôt, installe l'archive, lance `assets`, `verify` et `build` (chaque fichier de `dist/` justifié), et joue le jeu
  jusqu'à sa fin dans Chromium. Un fichier du nouveau projet qui nomme le dépôt le fait échouer.
- **`npm run external-consumer`** (job de CI `external-consumer`, et dans le candidat sous Ubuntu, macOS et Windows sur
  les archives du candidat lui-même, `--tarballs=`) : les archives utilisées comme un tiers les utilise. Il lit chaque
  archive (nom, version, licence, binaires, exports, aucune dépendance `file:` ni `link:`, aucun chemin du dépôt ; les
  fichiers du bundle de documentation contre leur sha256) ; crée un jeu sur une release plus ancienne (`--from`, 4.1.17
  par défaut), le fait passer au candidat comme son auteur le ferait (désinstaller l'ancien paquet, installer
  `quest-n-click`, `npx quest-n-click migrate`), joue une ancienne sauvegarde et une nouvelle partie jusqu'à la fin ;
  appelle `read_doc`, `list_docs` et `search_docs` par un vrai client MCP en stdio ; lance `npx create-quest-n-click` ;
  installe le Bridge (init, doctor, serve sur SQLite, et sur Postgres quand `CONSUMER_PG_URL` est défini) et les
  connecteurs, puis un webhook email signé accepté, le même message vu comme doublon, une mauvaise signature refusée.
- **`--publish-dry-run`** dans `release-check` et dans le job `pack` du candidat : ce que `npm publish` enverrait.
- **SBOM** : le candidat fait un SBOM CycloneDX par archive (`scripts/sbom.mjs`), depuis ce que l'archive contient.

<a name="npm-publishing"></a>

## La publication sur npm : pas encore faite

Chaque release joint les cinq archives ; **aucune n'est publiée sur le registre npm** à la 4.4.0. On installe depuis
l'archive de la release ([Installer depuis l'archive de la release](install.from-archive.md)). Les étapes ci-dessous
ont été écrites en 4.1.20 pour une 4.2.x ; la 4.2.0 n'a été publiée que sur GitHub Releases (D38), parce que chaque
étape demande la 2FA du mainteneur, et aucune version suivante ne les a encore jouées. Elles n'ont pas changé.

> [!LIMIT id=not-on-npm]
> À la 4.4.0, `npm install quest-n-click` depuis le registre n'installe pas ce projet : les noms sont libres ou
> réservés, pas publiés. Utilisez les fichiers `.tgz` de la release.

<a name="npm-names"></a>

### Les noms, surveillés chaque nuit

Les cinq noms (`quest-n-click`, `create-quest-n-click`, `quest-n-click-bridge`, `quest-n-click-connectors`,
`quest-n-click-studio-server`) et les anciens (`web-scumm`, `create-web-scumm`, `web-scumm-bridge`,
`web-scumm-connectors`, `web-scumm-studio-server`) sont vérifiés chaque nuit par le job `npm-names` de
`.github/workflows/nightly.yml`, qui ne bloque jamais : chacun est « still free » (un 404), « ours » (publié par
exactement l'utilisateur npm du mainteneur), ou un avertissement « taken » dans le résumé du run, pour que le
mainteneur agisse. Le squatting est un risque accepté jusqu'à la publication npm (D34, D38).

<a name="publishing-steps"></a>

### Les étapes de publication (écrites en 4.1.20, pour une 4.2.x ultérieure)

1. **Versions.** La publication en étapes demande au moins npm 11.15.0 et Node 22.14.0 ([doc npm][staged]). release.yml
   épingle l'étape de publication à des versions **exactes** dans son env, `NPM_PUBLISH_NODE: 22.23.3` et
   `NPM_PUBLISH_NPM: 11.21.0` ; `tests/release-stable.test.ts` et `ship preflight-stable` refusent une plage. Node
   22.23.3 livre npm 10.9.9 : l'étape de publication, quand elle sera écrite, installera elle-même npm 11.21.0
   (`npm install -g npm@11.21.0`). Seuls les épinglages existent aujourd'hui.
2. **Le compte.** Le compte npm du mainteneur a la 2FA activée.
3. **Bootstrap, une fois par paquet.** Les paquets n'existent pas encore. On met en scène une **version de
   réservation**, jamais une version du produit :

   ```sh
   # dans le dossier de l'archive, depuis la session du mainteneur (ou avec un jeton stage-only)
   npm stage publish <archive of 0.0.0-bootstrap.0>
   ```

   - Mettre en scène un paquet qui n'existe pas publie un placeholder `0.0.0-stage` jusqu'à son approbation
     ([doc npm][staged]). Vérifier avec `npm view <nom>` si cela suffit à configurer le paquet. Sinon, approuver le
     bootstrap (`npm stage approve <id>`, avec la 2FA).
   - Une publication locale ne porte pas de provenance OIDC. C'est pourquoi elle ne porte jamais une version du
     produit.
4. **Trusted publishing, en stage-only.** Sur chaque paquet :

   ```sh
   # n'importe où, connecté à npm en tant que mainteneur
   npm trust github <name> --repo Quest-n-Click/quest-n-click --file release.yml --allow-stage-publish
   ```

   - La CI peut alors mettre en scène, jamais publier.
   - La configuration doit réussir sa première publication en moins de **deux jours**, sinon elle expire : la
     configurer juste avant le run de release qui s'en servira.
5. **Promotion.** Le run de release met chaque paquet en scène par OIDC. Le mainteneur promeut chacun avec sa 2FA
   (`npm stage approve <id>`, ou sur npmjs.com).
6. **Classement dual-use de `quest-n-click-connectors`** (décidé en 4.1.20, PR 3b) :
   - la [politique dual-use][dual] de npm vise les « capacités sensibles pour la sécurité, qui peuvent ressembler à un
     logiciel malveillant » : outils de test d'intrusion, utilitaires de recherche en sécurité, obfuscation ;
   - les connecteurs sont des serveurs qu'un jeu fait tourner (une façade SSH et Telnet pour son terminal, un webhook
     et un lecteur IMAP pour l'email, un vérificateur Open Badge). Ils ne scannent rien, n'attaquent rien et ne cachent
     rien. **Ils ne sont pas déclarés dual-use** ;
   - ils passent de toute façon par la publication en étapes et une promotion 2FA, comme chaque paquet. C'est la
     méthode de publication que la politique demande au contenu dual-use ;
   - si l'analyse de npm à la publication retient ou signale le paquet, on ajoute
     `"contentPolicy": { "class": "dual-use" }` et un fichier `DISCLOSURE`. La déclaration persiste ensuite d'une
     version à l'autre.

`npm run ship -- preflight-stable --candidate=<run>` vérifie, pour chaque paquet, l'archive, le nom, le bootstrap, le
trusted publisher, une publication OIDC prouvée et la version pas encore publiée
([Publier une release](contribute.releasing.md#preflight)).

[staged]: https://docs.npmjs.com/staged-publishing
[dual]: https://docs.npmjs.com/policies/dual-use/

<a name="related"></a>

## Voir aussi

- `npm run pack`, `npm run fresh-install`, `npm run external-consumer`, `npm run locks`, `npm run ship`.
- [Publier une release](contribute.releasing.md), [Référence du paquet](install.package.md),
  [Installer depuis npm](install.from-npm.md).
