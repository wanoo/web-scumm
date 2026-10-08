# web-scumm 4.1.17 — Stabilization

> **Statut : proposition de correctif après la publication de v4.1.16 « Convergence ».**  
> **Base exacte :** tag `v4.1.16`, commit `969929c4a1e4e7d7d6115ac7340b916e59fb2ce4`.  
> **Nature :** correction, preuve et exploitation ; aucune nouvelle mécanique de jeu.  
> **Branche recommandée :** `fix/4117-stabilization`.  
> **But :** rendre verte avant publication la vérité que le premier nightly a découverte après la 4.1.16.

## 1. Décision de version

La 4.1.16 a fermé le contrat entre Remix, Time Attack, Daily, Mystery et le Bridge : une course schema 2 transporte
son monde exact, le vérificateur le reconstruit depuis sa graine, l'applique avant le replay et place le résultat sur
le classement correspondant. Elle a également rendu les runs et challenges quotidiens durables dans SQLite et
PostgreSQL, puis raccordé les quatre runtimes à la gate de CI.

La release n'est cependant pas encore stabilisée : son premier nightly a échoué, un test de charge SQLite n'a jamais
démarré, le classement peut ignorer le meilleur temps après 10 000 runs, et certaines règles annoncées comme
« vérifiées » reposent encore sur une déclaration du client. La cadence des releases a dépassé celle de la suite
lourde : le nightly précédent validait un commit de l'époque 4.1.9, pas le candidat 4.1.16.

La 4.1.17 est donc un patch correctif. Elle ne doit ajouter ni connecteur, ni renderer, ni primitive de gameplay, ni
nouveau mode Remix. Elle doit :

1. remettre toutes les sources de vérité au vert sur le commit exact destiné au tag ;
2. corriger la justesse du leaderboard et de l'admission distribuée ;
3. rendre explicite et vérifiable la frontière entre replay, résultat de minijeu et attestation serveur ;
4. faire entrer les nouveaux contrats Remix et Speedrun dans les gates qui prétendent les protéger ;
5. préparer la 4.2 sans la déclarer stable avant les passages humains prévus par D18.

## 2. État de départ vérifié

### 2.1 Ce qui est sain et doit rester vrai

- la CI du tag `v4.1.16` est verte ;
- les artefacts de release proviennent du commit taggé et sont accompagnés de checksums, SBOM et manifestes ;
- `v4.1.14` et `v4.1.15` sont ancêtres de `v4.1.16` ;
- `.wsrun` schema 1 reste interprété comme Story et schema 2 scelle son `WorldVariant` ;
- une variante schema 2 est régénérée depuis sa seed avant d'être appliquée ;
- Daily et Mystery vérifient leurs preuves signées ;
- Node, Chromium, WebKit et Firefox produisent la même run ;
- les runs et les challenges quotidiens survivent à un redémarrage SQL ;
- le bundle initial reste sous le budget bloquant de 140 KB gzip : demo 133 KB, reference 137 KB ;
- l'installation de la release ne signale aucune vulnérabilité npm connue ;
- 1 919 tests Node, 30 sauvegardes golden et 1 472 déclarations de tests sont comptés dans la baseline.

### 2.2 Défauts reproduits après le tag

Premier nightly de la release : run GitHub Actions `37765270588`, commit exact du tag.

#### Suite lourde du solveur

Trois tests échouent :

1. `tests/memo.test.ts` : le gain reste proche de deux, mais manque le seuil strict ; l'assertion compare
   `139916 < 136176` et échoue ;
2. `tests/partition.test.ts` : la matrice 1/2/4 workers dépasse 600 secondes ;
3. `tests/solver-oracle.test.ts` : `reference proof` diffère de l'oracle 4.1.8.

L'écart de l'oracle est circonscrit :

- verdict `solved` inchangé ;
- 288 états dans les deux cas ;
- même chemin gagnant ;
- même ensemble atteignable ;
- aucun softlock supplémentaire ;
- digest `steps` : `77d8e4f8b6ed32b4` → `a3ff31b3c1f9ba62` ;
- digest `flags` : `c9d2337ef8fa22bb` → `22445e172519e4ee`.

Ce constat n'autorise pas à réécrire la fixture automatiquement. Il impose de produire le diff sémantique, de dater
le changement et de décider s'il est voulu. La fixture n'est mise à jour qu'avec une entrée de LOG et une explication
dans la baseline.

#### Charge SQLite

La matrice du nightly affecte une chaîne vide à `BRIDGE_STORE` dans sa ligne SQLite :

```yaml
BRIDGE_STORE: ${{ matrix.store == 'postgres' && 'postgres://…' || '' }}
```

`openStore("")` refuse correctement la configuration. Le test de charge SQLite n'a donc pas mesuré SQLite. Le rapport
doit être produit pour les deux stores, jamais ignoré lorsqu'il manque.

#### Classement après 10 000 runs

`SqlRunStore.board()` et `MemoryRunStore.board()` prennent jusqu'à 10 000 runs par ordre de soumission. `RunQueue`
cherche ensuite le meilleur temps de chaque joueur et trie les résultats. Une run plus rapide soumise en 10 001e
position est absente du résultat. Le défaut est reproduit avec 10 001 lignes : `hasFastest === false`.

#### Résultat de roue déclaré par le client

`SessionEntry.mg` enregistre le résultat que le présentateur annonce. Le replay vérifie que ce résultat a été
enregistré et le réinjecte, mais ne prouve pas que la réponse correcte a été donnée. Une catégorie stricte peut donc
lire `won` sans pouvoir reconstruire la victoire. L'intégrité de l'enveloppe ne transforme pas cette déclaration en
preuve de jeu.

### 2.3 Dette explicitement reportée par la 4.1.16

- 234 mutants Remix/Speedrun restent à lire : 137 Remix et 97 Speedrun ;
- les sets `remix` et `speedrun` sont mesurés mais absents de `GATED` ;
- la reprise par politique de monde n'est pas traversée dans `e2e:remix-speedrun` ;
- le parcours Mystery complet du joueur n'existe pas ;
- le profil conteneur sans réseau du worker est documenté mais non exécuté en CI ;
- `bridge serve` ne configure pas le bearer d'administration de la modération ;
- les warnings du futur loader natif Vite restent présents ;
- le tag n'est pas signé ;
- les quinze passages humains de la fiche 4.1.16 sont encore à faire.

## 3. Principes non négociables

1. **Un tag stable ne découvre pas son premier échec lourd après sa publication.**
2. **Un test vert doit avoir réellement exercé le backend qu'il nomme.** Un rapport absent est un échec.
3. **Un classement est ordonné sur les meilleurs temps, pas sur les premières soumissions lues.**
4. **Un résultat déclaré n'est pas une preuve.** Le niveau de confiance doit le dire et la catégorie doit en tenir
   compte.
5. **Aucune fixture n'est bénie sans diff sémantique et décision écrite.**
6. **Aucun budget n'est relevé pour faire disparaître un rouge avant d'avoir profilé sa cause.**
7. **Les limites annoncées comme distribuées sont atomiques dans le store partagé, ou documentées comme locales.**
8. **Les mutations sont lues une par une.** Un groupe de survivants ne devient pas « équivalent » par commodité.
9. **Le patch ne mélange pas correction et refactoring général.** Les extractions servent une frontière testée.
10. **La 4.2 reste bloquée par D18.** La 4.1.17 prépare les passages humains ; elle ne les simule pas.

## 4. Lot A — Rendre la chaîne de release honnête

### 4.1 Corriger la matrice de charge

La matrice doit porter un `spec` explicite plutôt qu'une valeur vide :

```yaml
matrix:
  include:
    - store: sqlite
      spec: sqlite:.cache/bridge-load.sqlite
    - store: postgres
      spec: postgres://bridge:bridge@127.0.0.1:5432/bridge
```

Le test :

- refuse `BRIDGE_STORE=""` avec un test unitaire de configuration ;
- crée un chemin SQLite propre à la ligne ;
- produit un rapport JSON pour SQLite et PostgreSQL ;
- fait échouer le job si le rapport manque, s'il annonce un autre backend ou si ses compteurs sont incomplets ;
- conserve le rapport comme artefact avec commit, runtime, store, durée et résultat.

Ne pas lancer le service PostgreSQL dans la ligne SQLite si GitHub Actions permet de séparer proprement les jobs ; à
défaut, documenter son coût mais ne jamais le confondre avec le backend testé.

### 4.2 Ajouter une gate de candidat complète

Introduire `npm run release-check:full` ou un workflow `candidate.yml` qui exécute, sur le commit exact :

```text
release-check
test:heavy
bridge:load SQLite
bridge:load PostgreSQL
cross-runtime
mutation core + reality + remix + speedrun
```

Règles :

- une RC peut être créée avant cette gate ;
- le tag stable ne peut viser qu'un commit dont la gate complète est verte ;
- le workflow de release vérifie par SHA, pas seulement par nom de branche ou statut récent ;
- un résultat provenant d'un autre commit n'est pas réutilisé ;
- un job ignoré par condition n'est jamais présenté comme exécuté ;
- le cache de mutation est accepté seulement si son `inputHash` correspond exactement au candidat ;
- le nightly reste indépendant et repart à frais nouveaux sur les tests dont le but est de détecter le flaky.

La suite lourde n'a pas besoin de tourner sur chaque petite pull request. Elle doit tourner sur :

- une PR portant le label `full-ci` ;
- toute RC ;
- tout candidat au tag stable ;
- le nightly.

### 4.3 Rendre les résultats lisibles

Le résumé de la gate doit afficher :

- SHA testé et SHA taggé ;
- statut de chaque famille ;
- backend réellement ouvert pour chaque charge ;
- nombre d'états et durée des tests solveur ;
- input hash et score de chaque set de mutation ;
- runtimes réellement traversés ;
- artefacts manquants ;
- passages humains encore ouverts.

### Critère de sortie du lot A

Un candidat artificiellement rouge dans `test:heavy` ou configuré avec `BRIDGE_STORE=""` ne peut pas être publié par
la chaîne automatique. Les deux lignes de charge produisent un rapport vérifié.

## 5. Lot B — Stabiliser les tests lourds du solveur

### 5.1 Diff sémantique de l'oracle

Ajouter à l'outil d'oracle une sortie de diagnostic qui montre, pour chaque cas différent :

- champs de `SolveResult` différents ;
- première `SessionEntry` différente ;
- flags ajoutés, retirés ou réordonnés ;
- première clé d'état atteignable différente ;
- version du moteur, Node et options de recherche.

Procédure pour `reference proof` :

1. exécuter le cas sur le commit ayant généré la fixture ;
2. exécuter le cas sur `v4.1.15` et `v4.1.16` avec leurs dépendances respectives ;
3. identifier le premier commit qui change `steps` ou `flags` ;
4. vérifier que ce changement vient bien d'un contrat intentionnel, notamment `SessionEntry.mg` ou les flags réservés ;
5. corriger le moteur si la dérive est accidentelle ;
6. sinon, écrire la décision puis régénérer uniquement les cas justifiés ;
7. relancer les 203 recherches sans `ORACLE_WRITE`.

Le statut, les états et le chemin identiques ne suffisent pas : l'oracle protège aussi ce que les outils et replays
observent.

### 5.2 Mémoïsation

Mesurer séparément :

- tentatives ;
- transitions utiles ;
- no-ops mémorisés ;
- temps CPU et mur ;
- mémoire maximale ;
- répétabilité sur cinq exécutions isolées.

Ne pas remplacer immédiatement le facteur deux par une valeur plus faible. Déterminer d'abord si :

- un nouveau champ rend la clé trop précise ;
- une action sans effet n'est plus reconnue ;
- le benchmark est trop proche d'un seuil instable ;
- la plateforme de CI introduit seulement une variation de durée — ce qui ne doit pas affecter un compteur
  déterministe.

Si le nouvel optimum théorique est légitimement inférieur à deux, le nouveau seuil est basé sur une baseline écrite
et garde une marge de régression, jamais sur la seule valeur qui vient d'échouer.

### 5.3 Partition 1/2/4 workers

Instrumenter chaque étape :

- construction de frontière ;
- sérialisation et transfert ;
- démarrage des workers ;
- exploration par partition ;
- fusion ;
- arrêt et nettoyage.

Le test doit dire quelle configuration dépasse son budget. Il doit tuer ses workers et conserver leur profil au lieu
d'attendre le timeout global de Vitest. Comparer les verdicts et ensembles atteignables à la recherche monolithique.

Une augmentation de timeout n'est acceptable que si :

- le nombre d'états attendu est inchangé ;
- aucune boucle ou duplication nouvelle n'existe ;
- la durée mesurée sur runner justifie le budget ;
- le budget conserve au moins 25 % de marge sur trois runs propres.

### Critère de sortie du lot B

`npm run test:heavy` passe trois fois à froid sur le runner de référence. L'oracle ne contient aucun diff non expliqué,
la partition termine sous budget et le profil de mémoïsation respecte une baseline décidée.

## 6. Lot C — Corriger le leaderboard à toute taille

### 6.1 Définir le vrai contrat du store

L'interface ne doit plus signifier « donne-moi les 10 000 premières candidates ». Elle doit demander :

```ts
interface LeaderboardQuery {
  tenantId: string;
  gameId: string;
  categoryId: string;
  leaderboardKey: string;
  seedKind?: 'fixed' | 'random';
  limit: number;
}

interface LeaderboardRow {
  run: RunRecord;
  rank: number;
}
```

Le store applique dans cet ordre :

1. tenant, jeu, catégorie, clé, verdict `valid`, temps non nul ;
2. meilleur temps par pseudonyme ;
3. ordre numérique du temps, puis date et id ;
4. égalités avec le même rang ;
5. limite de réponse.

La limite porte sur le résultat final. Elle ne doit jamais supprimer une run potentiellement meilleure avant le
classement.

### 6.2 Temps décimaux canoniques

`ranked` accepte aujourd'hui jusqu'à trente chiffres. À l'écriture :

- refuser les signes et valeurs non décimales ;
- normaliser les zéros de tête avec `BigInt` (`"00042"` → `"42"`) ;
- conserver `"0"` ;
- refuser une valeur au-delà de la limite documentée.

Pour rester portable entre SQLite et PostgreSQL, l'ordre peut utiliser longueur puis ordre lexical sur une chaîne
canonique, ou un type numérique explicitement compatible dans les deux adapters. Ne pas convertir en `number`.

### 6.3 Index et migration

Ne pas modifier `0002` après sa publication. Ajouter une migration `0003` si un index ou une colonne est nécessaire.
Mesurer avec `EXPLAIN` sur les deux stores. Le chemin de lecture ne charge jamais les enveloppes de 2 MB.

### 6.4 Tests obligatoires

- la 10 001e run, plus rapide que toutes les autres, devient rang 1 ;
- un joueur ayant 10 001 runs ne garde que son meilleur temps ;
- une run tardive plus rapide remplace l'ancienne ;
- égalité de temps : même rang, ordre secondaire stable ;
- temps au-delà de `Number.MAX_SAFE_INTEGER` ;
- zéros de tête ;
- séparation stricte tenant/jeu/catégorie/monde/seed kind ;
- SQLite, PostgreSQL et store mémoire donnent exactement le même JSON ;
- aucune enveloppe n'est lue pour construire le classement ;
- le temps de réponse et la mémoire restent bornés sur le corpus de charge.

### Critère de sortie du lot C

Le test à 10 001 runs retrouve toujours la meilleure run. Les trois stores produisent les mêmes rangs et le rapport de
charge inclut une lecture de leaderboard après les écritures.

## 7. Lot D — Admission réellement distribuée

### 7.1 File maximale atomique

Le contrat actuel fait `queued()` puis `create()` en deux opérations. Deux instances peuvent toutes deux observer 99
et insérer au-delà de 100. Remplacer cela par une admission atomique dans le store :

```ts
type Admission =
  | { status: 'created' }
  | { status: 'duplicate' }
  | { status: 'full' };

admit(run: RunRecord, maxQueued: number): Promise<Admission>;
```

La transaction compte et insère sous un verrou adapté au tenant. L'unicité de `runKey` reste garantie par la base.
Le store mémoire reproduit les mêmes résultats en concurrence.

Décider explicitement si les runs `verifying` comptent dans la capacité. Le choix recommandé est une capacité totale
`queued + verifying`, car chaque ligne représente du travail et du stockage non terminé.

### 7.2 Rate limit multi-instance

Le token bucket actuel vit dans chaque processus. Deux choix acceptables :

1. ajouter un `SubmissionLimiter` partagé par SQL, atomique et borné ;
2. documenter le limiteur applicatif comme local et rendre obligatoire un rate limit global au proxy pour le profil
   multi-instance.

Le choix recommandé pour la 4.1.17 est l'interface injectable :

- implémentation mémoire pour développement ;
- implémentation SQL pour le profil distribué ;
- clé client pseudonymisée par HMAC avec un secret d'exploitation, jamais une IP brute durable ;
- expiration et purge bornées ;
- réponse `429` et `Retry-After` cohérentes sur toutes les instances.

### 7.3 Tests de course

- deux instances soumettent simultanément la même run : une création, un duplicate ;
- plusieurs instances tentent de dépasser la capacité : jamais plus que la limite ;
- un client réparti sur trois instances reçoit le même quota global ;
- deux tenants n'épuisent pas le quota l'un de l'autre ;
- une panne entre débit et insertion ne consomme pas définitivement une place ;
- aucune donnée personnelle brute n'apparaît dans la base ou les logs.

### Critère de sortie du lot D

Les limites annoncées « toutes instances ensemble » sont prouvées avec PostgreSQL. Tout ce qui reste local est nommé
« par instance » dans l'API et la documentation.

## 8. Lot E — Résultats de minijeux et niveau de confiance

### 8.1 Nommer correctement la garantie actuelle

Une run `replay-valid` prouve aujourd'hui :

- que la session se rejoue sur le jeu, la catégorie et le monde annoncés ;
- que sa chaîne, ses tirages, son état final et son temps logique sont cohérents ;
- que les résultats de minijeu enregistrés sont réinjectables.

Elle ne prouve pas :

- que le joueur a réellement produit le résultat `mg` ;
- que `inputsUsed`, les pauses ou le RTA sont complets ;
- qu'une roue physique a été utilisée ;
- que la personne n'a pas synthétisé une enveloppe valide hors du joueur.

Les docs, le Studio, le Bridge et les messages ne doivent jamais confondre `replay-valid` avec
`server-witnessed` ou « anti-cheat ».

### 8.2 Transcript déterministe de la roue numérique

Pour une roue numérique classable, enregistrer les décisions nécessaires au jugement, pas seulement son verdict :

```ts
interface CodeWheelTranscript {
  version: 1;
  wheelHash: string;
  attempts: readonly string[];
  result: 'won' | 'failed' | 'passed' | 'skipped';
}
```

- `wheelHash` scelle la roue déterministe produite par le monde et la catégorie ;
- les réponses sont des ids canoniques, pas du texte localisé ;
- le replay régénère la roue et appelle `judge()` ;
- le résultat recalculé doit correspondre ;
- une tentative ajoutée, retirée ou modifiée invalide la run ;
- le transcript est borné en taille et validé comme donnée non fiable.

Éviter un champ réservé uniquement à la roue si le contrat générique des minijeux peut rester simple : une définition
de minijeu peut exposer un codec de transcript et un vérificateur pur. Aucun minijeu non compétitif n'est obligé de
produire un transcript.

### 8.3 Roue physique et anciennes runs

Une roue physique ne peut pas être prouvée par le navigateur seul. Une catégorie qui exige le support physique :

- reste `valid-unranked` sans témoin ;
- devient `server-witnessed` ou `moderator-verified` avec la procédure correspondante ;
- n'invente jamais une preuve à partir de `medium: 'physical'` déclaré par le client.

Pour les anciennes runs schema 2 :

- ne pas changer silencieusement le sens d'une catégorie existante ;
- augmenter `rulesVersion` si une catégorie passe d'un verdict déclaré à un transcript exigé ;
- conserver le replay historique avec son niveau de confiance historique ;
- ne jamais reclasser automatiquement une ancienne run comme attestée.

### 8.4 Tests

- changer `mg: won` sans transcript ne produit pas une run strictement classable ;
- réponse correcte → `won`, mauvaises réponses → `failed` ;
- résultat et transcript contradictoires → `invalid-replay` ;
- roue d'un autre monde → refus ;
- texte traduit sans changement d'id → même preuve ;
- reprise après chunk conserve exactement le transcript ;
- Node et les trois navigateurs produisent les mêmes octets ;
- roue physique sans témoin → `valid-unranked` ;
- catégorie narrative sans exigence compétitive reste compatible.

### Critère de sortie du lot E

Une catégorie exigeant la victoire numérique ne peut être satisfaite par le seul mot `won`. Le résultat est recalculé
ou la run est explicitement non classée.

## 9. Lot F — Fermer les gates de mutation

### 9.1 Ordre de lecture

Traiter les 234 survivants par risque :

1. `speedrun/verify.ts` ;
2. `speedrun/envelope.ts` ;
3. `remix/compile.ts` et `remix/apply.ts` ;
4. `remix/categories.ts` ;
5. `speedrun/recorder.ts` ;
6. `remix/seed-code.ts`.

Pour chaque survivant :

- écrire le comportement qui devrait le tuer ;
- ajouter un test si le comportement compte ;
- supprimer ou simplifier le code si la branche ne compte pas ;
- ne nommer « équivalent » qu'avec une justification précise et durable dans `mutants.json` ;
- régénérer la table de `MUTANTS.md` avec l'outil, jamais à la main.

### 9.2 Promotion dans la gate

Quand aucun survivant inexpliqué ne reste :

```ts
const GATED = ['core', 'reality', 'remix', 'speedrun'];
```

Le hash d'entrée doit couvrir sources, tests, configuration, lockfile et liste des équivalents. Une modification du
vérificateur ou du générateur invalide le cache correspondant.

`connectors` et `reality-store` conservent leur calendrier propre si leur dette n'est pas incluse dans ce patch ; la
documentation ne doit pas laisser entendre qu'ils sont déjà gated.

### Critère de sortie du lot F

`test:mutation:remix` et `test:mutation:speedrun` passent avec zéro survivant inexpliqué et font échouer
`release-check:full` lorsqu'un mutant volontaire est introduit.

## 10. Lot G — Parcours de production manquants

### 10.1 Reprise par politique de monde

Étendre `e2e:remix-speedrun` pour interrompre puis reprendre au moins :

- Story ;
- Fixed ;
- Random ;
- Daily ;
- Mystery.

Après reprise : mêmes `h0`, variant, preuves, chunks, `finalProof`, verdict et leaderboard key. Reprendre dans un autre
monde ou avec une autre preuve est refusé avant toute nouvelle entrée.

### 10.2 Parcours Mystery du joueur

Fermer le parcours sans changer la cryptographie :

```text
demande de commitment
→ monde caché
→ départ recorder avec commitment
→ fin ou abandon
→ reveal
→ vérification
→ valid-unranked sans témoin, ou rangé avec attestation serveur
```

Tester expiration, mauvais mode, reveal absent, commitment d'un autre tenant, reprise et abandon.

### 10.3 Worker dans son vrai profil

Ajouter une CI Linux lançant le worker dans le profil documenté :

- `--network none` ;
- racine en lecture seule ;
- `/tmp` borné ;
- aucune capability ;
- `no-new-privileges` ;
- heap et timeout bornés ;
- arrêt du conteneur entier après timeout.

Un jeu fixture tente `fetch`, DNS, TCP, écriture hors `/tmp` et processus enfant. Les opérations sont refusées et le
worker suivant démarre normalement. Le refus in-process reste une défense supplémentaire, pas la sandbox annoncée.

### 10.4 Modération

Raccorder `adminToken` à `bridge serve` :

- secret hors des fichiers publics et des logs ;
- comparaison constante ;
- absence de token : route désactivée ou refus explicite ;
- compteurs succès/refus ;
- tests 401, mauvais bearer, bon bearer, tenant croisé et run non vérifiée.

### Critère de sortie du lot G

Les parcours publiés Daily/Mystery/reprise passent à travers le vrai recorder et le vrai worker. Le profil conteneur et
la modération ne sont plus seulement des exemples de bibliothèque.

## 11. Lot H — Livraison, documentation et provenance

### 11.1 Documents de vérité

Mettre à jour dans les deux langues :

- `SPEEDRUN.md` : niveaux de confiance et transcripts ;
- `REMIX.md` : reprise des cinq politiques ;
- `REALITY-OPS.md` : admission distribuée, proxy, worker et modération ;
- `SUPPORT.md` : compatibilité des nouvelles entrées optionnelles ;
- `ROADMAP.md` et `PROGRAM-4.1.md` ;
- `CHANGELOG.md` ;
- baseline et fiche de passes 4.1.17.

`docs:truth` vérifie les noms de scripts, schemas, versions, sets gated, routes et limites. Il ne remplace pas une
lecture humaine des promesses.

### 11.2 Tag et artefacts

- signer le tag 4.1.17 ;
- publier l'identité de signature attendue ;
- produire checksums, SBOM, manifeste, rapports de charge, résumé de gate et résultats de mutation ;
- ajouter une attestation de provenance GitHub/OIDC si disponible ;
- vérifier l'archive réinstallée, pas seulement le checkout ;
- conserver la run schema 2 de référence et une fixture de compatibilité 4.1.16.

### 11.3 Poids

La correction ne doit pas augmenter le premier chargement au-delà de :

- demo : baseline 133 KB gzip, budget 140 KB ;
- reference : baseline 137 KB gzip, budget 140 KB.

Le transcript et les composants Bridge ne doivent pas entrer dans le bundle du joueur quand ils ne sont pas utilisés.
Le but 130 KB reste un objectif de 4.2, pas une raison de supprimer une vérification nécessaire.

## 12. Découpage recommandé en pull requests

| PR | Branche | Contenu | Seconde lecture |
|---|---|---|---|
| 1 | `fix/4117-release-truth` | SQLite nightly, rapports obligatoires, candidate gate, diagnostic oracle | solveur + CI |
| 2 | `fix/4117-solver-heavy` | oracle expliqué, memo profilé, partition sous budget | solveur indépendant |
| 3 | `fix/4117-leaderboard` | meilleur temps avant limite, temps canonique, migration/index | concurrence + SQL |
| 4 | `fix/4117-admission` | capacité et quota multi-instance atomiques | sécurité + concurrence |
| 5 | `fix/4117-minigame-proof` | transcript, jugement rejoué, niveaux de confiance | sécurité + compatibilité |
| 6 | `test/4117-mutation-gates` | survivants Remix/Speedrun, promotion dans `GATED` | lecture mutation |
| 7 | `chore/4117-production-paths` | reprises, Mystery, conteneur, modération, docs et release | exploitation |

Chaque PR :

1. part de `origin/main` après la précédente, sauf lots réellement indépendants ;
2. reproduit son défaut par un test rouge ;
3. ajoute ses fragments de changelog et de LOG ;
4. ne régénère aucune baseline non concernée ;
5. reçoit une seconde lecture différente de son auteur ;
6. fusionne seulement avec `pr-gate` vert ;
7. garde un diff assez petit pour être relu humainement.

## 13. Commandes de validation

Minimum pour chaque PR selon son périmètre :

```bash
npm run quality
npm run docs:truth
npm run test:node
npm run build:game
npm run quality:baseline -- --check --dist
```

Avant la RC :

```bash
npm run test:heavy
npm run test:mutation:remix
npm run test:mutation:speedrun
npm run e2e:canonical
npm run e2e:remix
npm run e2e:speedrun
npm run e2e:remix-speedrun
npm run release-check:full
```

Les commandes de charge tournent en CI sur les deux stores et archivent leurs rapports. Aucun résumé manuel ne
remplace la sortie complète.

## 14. Critères de sortie de la 4.1.17

La 4.1.17 ne doit pas être taggée tant que l'un de ces points est faux :

1. le commit candidat n'a pas passé `release-check:full` ;
2. `test:heavy` n'est pas vert trois fois à froid sur le runner ;
3. l'oracle contient un diff non expliqué ou a été régénéré sans décision ;
4. le test 1/2/4 workers dépasse son budget ou laisse un processus ;
5. la mémoïsation manque sa baseline décidée ;
6. les charges SQLite et PostgreSQL n'ont pas chacune produit un rapport complet ;
7. la 10 001e run la plus rapide peut manquer au leaderboard ;
8. SQLite, PostgreSQL et le store mémoire ne rendent pas les mêmes rangs ;
9. deux instances peuvent dépasser la capacité globale annoncée ;
10. le quota présenté comme global reste seulement en mémoire sans que cela soit explicitement documenté ;
11. une catégorie exigeant une roue gagnée accepte le seul mot client `won` comme preuve classable ;
12. une ancienne run change silencieusement de catégorie ou de niveau de confiance ;
13. un mutant Remix ou Speedrun inexpliqué survit à la gate ;
14. la reprise n'a pas été traversée sur les cinq politiques de monde ;
15. le parcours Mystery du joueur ne rejoint pas le vérificateur ;
16. le worker n'a pas été testé dans le profil de confinement documenté ;
17. `bridge serve` ne peut pas exercer et auditer la modération ;
18. Pages peut se déployer avec `pr-gate` rouge ;
19. le bundle dépasse 140 KB gzip ;
20. le tag, les artefacts et le commit testé diffèrent ;
21. le tag final n'est pas signé ;
22. les limites restantes ne figurent pas dans la fiche de passes.

## 15. Passages humains et relation avec la 4.2

Les quinze passages de `docs/dev/passes/4.1.16.md` restent la porte de la 4.2. La 4.1.17 doit fournir le matériel et
les procédures pour les réaliser, puis enregistrer chaque résultat. Elle n'a pas le droit de marquer automatiquement
un passage humain comme réussi.

Priorité avant la 4.2 :

1. Bridge multi-instance derrière HTTPS sur PostgreSQL, worker tué au milieu ;
2. Story, Remix et Daily soumis par de vraies personnes ;
3. reprise après arrêt complet de la machine ;
4. roue imprimée et lecteur d'écran ;
5. Safari hors ligne sur iPhone et Firefox réel ;
6. téléphone réel sur les deux renderers ;
7. LiveSplit et OBS ;
8. connecteurs réels et revue sécurité humaine ;
9. playtesteurs ne connaissant pas les puzzles ;
10. écoute des voix ;
11. signature et installation de l'archive publiée.

Chaque échec crée un ticket reproductible contenant appareil, OS, navigateur, versions, catégorie, monde, seed,
`.wsrun`, logs Bridge et résultat attendu.

## 16. Hors périmètre

- nouveau connecteur Reality ;
- nouveau renderer ou migration canvas/Phaser ;
- physique générale ;
- nouveau mode Remix ;
- nouvelle primitive DSL de gameplay ;
- nouvelle catégorie de speedrun sans besoin démontré ;
- réécriture du solveur ;
- refonte visuelle générale du Studio ;
- objectif 130 KB obtenu au prix d'une suppression fonctionnelle ;
- suppression de la compatibilité `.wsrun` schema 1 ou sauvegardes v3/v4 ;
- déclaration « anti-cheat » sans témoin ou attestation correspondante.

## 17. Définition du succès

La 4.1.17 est réussie quand la phrase suivante est littéralement vraie :

> Le commit publié a passé, avant son tag, les mêmes suites lourdes qui avaient rougi après la 4.1.16 ; ses deux
> stores ont réellement été chargés ; son leaderboard ne perd aucun meilleur temps ; et chaque niveau de confiance
> dit exactement ce que le système peut prouver.

Cette release ne rend pas web-scumm plus spectaculaire. Elle le rend plus digne de confiance — ce qui est précisément
le dernier travail nécessaire avant de demander à des personnes, et non plus seulement aux machines, de qualifier la
4.2 « Stable World ».
