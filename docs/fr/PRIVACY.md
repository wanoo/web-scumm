# Données personnelles : ce qui est gardé, où, combien de temps

Ce qu'un jeu web-scumm, son Reality Bridge et ses connecteurs gardent sur un joueur (4.1.9). L'opérateur qui fait
tourner un Bridge et ses connecteurs est celui qui répond de ces données devant les joueurs ; cette page dit ce que
le logiciel garde pour que l'opérateur puisse le dire à son tour. Un jeu sans `reality` ne garde rien au-delà de
l'appareil du joueur.

## Sur l'appareil du joueur

La sauvegarde et les sessions vivent dans le stockage du navigateur (IndexedDB), sur l'appareil seulement. Avec un lien
au monde elles contiennent aussi le `playerId` pseudonyme donné par le Bridge (`p-` et 16 chiffres hexadécimaux, tiré
de rien qui concerne la personne), le curseur de livraison et les ids des signaux appliqués : jamais un email, un
jeton, un message ou un badge. La capacité qui lit les signaux du joueur est gardée dans le `localStorage` du navigateur
(`<game>:reality-link`).
**Supprimer :** « Unlink » dans le menu pause révoque le lien sur le Bridge ; effacer la sauvegarde, ou les données du
site dans le navigateur, retire le reste.

## Sur le Bridge

Le journal (`journal.jsonl`, dans le dossier du Bridge) garde, par joueur : le `playerId`, le SHA-256 de sa capacité,
son expiration ; par signal : son id, sa séquence, son nom, sa source, la clé de déduplication du connecteur (un
SHA-256 pour les connecteurs de 4.1.9), le hash de ce que le connecteur a vu (`evidenceHash`), et les heures. Les codes
d'appairage vivent en mémoire dix minutes. Les journaux nomment des événements et des ids pseudonymes. **Combien de
temps :** jusqu'à ce que `compact --retention-days=<N>` (90 par défaut) retire les signaux acquittés de plus de N
jours. **Supprimer :** `DELETE /v1/admin/players/<id>` retire tout ce qui concerne un joueur ; `GET` sur la même route
l'exporte (`docs/fr/REALITY-OPS.md`).

## Connecteur email

**Mode webhook :** le message est lu en mémoire puis oublié ; rien n'est écrit. **Mode IMAP :** le message reste dans
la boîte de l'opérateur, là où il est arrivé : avec `keepDays: 0` (par défaut) il est supprimé dès que son signal est
accepté (ou trouvé déjà accepté), avec `keepDays: N` après N jours ; un message refusé est marqué et gardé pour
l'opérateur, qui le supprime. Un expéditeur qui a envoyé un code d'appairage est retenu comme un SHA-256 salé de son
adresse (le sel est aléatoire et vit autant que le processus) associé au `playerId`, en mémoire, pendant `linkDays`
(30 par défaut) ; un redémarrage l'oublie. L'adresse, le sujet et le texte ne sont jamais journalisés ni envoyés au
Bridge (seulement un hash du Message-ID et le numéro de la réponse, hachés à nouveau en `evidenceHash`). Aucune
réponse n'est envoyée.

## Connecteurs Telnet et SSH

Rien de ce qui est tapé n'est stocké : une ligne est comparée aux commandes du jeu puis oubliée ; le Bridge ne reçoit
que le nom du signal. Un mot de reprise relie une session ultérieure au même joueur pendant 30 minutes, en mémoire.
Les clés publiques qu'un opérateur déclare pour des joueurs (`ssh.keys`) vivent dans la configuration du connecteur
jusqu'à ce que l'opérateur les retire. L'adresse du client ne sert au système que pour la connexion ; le connecteur
n'en garde aucune liste.

## Connecteur Open Badges

Le badge et les documents vers lesquels il pointe sont récupérés, vérifiés puis oubliés ; seul un verdict sort du
connecteur, comme signal, avec un hash de l'id du badge et de son émetteur en `evidenceHash`. L'email qu'un joueur
donne pour comparer un bénéficiaire haché est haché avec le sel du badge pour la comparaison, puis oublié : il n'est
jamais stocké, journalisé ni envoyé. Les listes de révocation et de statut (celles d'un émetteur, pas d'une personne)
restent en cache un jour au plus. Les adresses qui postent sur le formulaire sont comptées en mémoire une minute (la
limite de débit), puis oubliées.

## Journaux et métriques

Chaque connecteur journalise des lignes JSON d'événements, d'identifiants (`playerId`, noms de signaux, codes de
refus) et de nombres. Une chaîne qui ressemble à du contenu (une espace, un `@`, une barre oblique) est écrite
`[redacted]` ; les tests vérifient qu'aucune adresse, aucun texte ni secret des fixtures n'atteint un journal. Les
métriques (`/metrics`) sont des compteurs en mémoire. La durée de vie des journaux est la rotation de l'opérateur ;
ils ne contiennent aucun contenu à supprimer, et un `playerId` y est pseudonyme.

## Supprimer les données d'un joueur, partout

1. Sur le Bridge : `DELETE /v1/admin/players/<id>` (le lien, le journal, les acquittements).
2. Dans une boîte IMAP : supprimer les messages marqués du joueur, s'il y en a (ceux acceptés sont déjà partis avec
   `keepDays: 0`).
3. Dans la configuration SSH : retirer la clé déclarée du joueur, s'il y en a une, et redémarrer le connecteur.
4. En mémoire (liens d'expéditeurs, mots de reprise) : redémarrer les connecteurs les oublie tous.
5. Sur l'appareil : le joueur efface la sauvegarde ou les données du site.
