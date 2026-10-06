# Reality Bridge : un jeu qui réagit au monde extérieur

Depuis la 4.1.1, un jeu peut réagir à un fait venu de l'extérieur : un email qui répond, un webhook appelé, plus tard
un badge présenté ou une commande tapée dans un terminal. Le jeu ne touche jamais au réseau : un service à part, le
**Reality Bridge**, transforme le fait en un court **signal** signé, et le jeu l'applique comme une entrée du joueur :
une fois, sauvegardé, rejouable. Cette page est pour les auteurs ; `docs/fr/REALITY-OPS.md` pour qui fait tourner un
Bridge ; `docs/dev/THREAT-MODEL.md` et `docs/dev/reality-spike.md` disent pourquoi il est construit ainsi.

## Déclarer les signaux

Un signal est un identifiant d'une liste finie que le jeu déclare. Il arrive dans le jeu comme l'événement du même nom :

```ts
reality: {
  bridge: 'https://bridge.example/',          // le Bridge auquel le menu pause se lie (http://127.0.0.1 en développement)
  signals: [
    { id: 'mail.answer.correct', source: 'mail', availability: 'required', replay: 'record',
      fallback: { verb: 'use', a: 'radio' } },  // ce que fait un joueur quand l'extérieur ne répond jamais
    { id: 'mail.answer.wrong', source: 'mail', availability: 'optional', replay: 'record' },
    { id: 'hook.bell', source: 'webhook', availability: 'optional', replay: 'record', once: false },
  ],
},
events: [
  { id: 'mail-opens-gate', on: 'mail.answer.correct', do: [{ set: 'gate_open' }, 'Une lettre : « Oui. »'] },
],
```

- **`id`** : lettres, chiffres et `. _ : -`. Rien d'extérieur n'atteint le jeu sinon cet identifiant : ni texte, ni
  adresse, ni contenu ; rien du dehors ne peut injecter une réplique, un drapeau ou du HTML.
- **`availability`** : `required` si la fin principale en a besoin. Un signal requis nomme un `fallback`, une règle que
  le joueur peut utiliser à la place ; `npm run validate` vérifie qu'elle correspond à une règle, et le jeu doit se
  finir sans l'extérieur.
- **`once`** (par défaut `true`) : l'effet du signal ne joue qu'une fois par partie, quel que soit le nombre de
  livraisons. `false` : chaque signal distinct venu du Bridge le rejoue (une livraison répétée du même, jamais).
- Dans un jeu avec `reality`, un événement écouté que rien n'émet ni ne déclare est une erreur : une faute de frappe
  attendrait sinon pour toujours un signal que le Bridge refuse.

Le jeu d'exemple est `games/signals/` : un portail ouvert par une réponse par email, ou par la radio si rien ne vient.

## Le prouver dans chaque monde

Une preuve ne suppose jamais que l'extérieur coopère. `npm run solve:reality` (dans `prove:game` et
`web-scumm release`) prouve le jeu dans trois sortes de mondes :

1. **fermé** : aucun signal. Le jeu doit se finir par ses fallbacks.
2. **chaque scénario** de `games/<id>/reality/scenarios/*.json` (`{ "signals": ["mail.answer.wrong", "mail.answer.correct"] }`) :
   ces signaux, dans cet ordre, chacun pouvant arriver à tout moment après le précédent. Un signal requis a besoin
   d'un scénario qui l'envoie.
3. **adversarial** : n'importe quel signal déclaré, à tout moment, encore et encore.

Chacun doit être résolu sans blocage et jamais tronqué. Le solveur donne le signal au moteur lui-même : aucun service
n'est contacté. Dans le MCP du Studio, `solve` prend `reality` pour essayer un monde.

`validate` vérifie que le `fallback` d'un signal requis nomme une règle ; le lint de contenu (`npm run lint`, dans
`verify:game`) vérifie que le témoin du monde fermé le joue. Un jeu qui se finit sans l'extérieur par un autre chemin
reçoit `fallback-unplayed`, un avertissement : le fallback est déclaré sur une règle dont personne n'a besoin, souvent
une qui ne peut pas s'exécuter ; déclarer l'action que joue le témoin, ou faire de celle déclarée le chemin.

## L'essayer dans le Studio

L'onglet Jouer montre un panneau **Reality** pour un jeu avec `reality` : un bouton par signal, des pannes à ajouter
(un délai, un doublon, une mauvaise signature, expiré), la file inversée, la connexion coupée puis reprise, et ce qui
est arrivé à chaque livraison. C'est un Bridge simulé avec une clé de développement : le signal passe par la même
vérification, la même session, la même sauvegarde et la même déduplication qu'un vrai.

## Entre les mains du joueur

Le menu pause a une ligne **World link** : « Link this game » montre un code de 8 caractères que le joueur donne au
connecteur du jeu (en répondant à l'email avec, en le tapant dans le formulaire du webhook) ; une fois confirmé, le jeu
est lié. Le lien est annoncé poliment, jamais par-dessus une réplique. Les signaux qui arrivent pendant que le jeu est
occupé (un dialogue, une cinématique, un mini-jeu) l'attendent. Hors ligne, le jeu continue ; de retour en ligne, ce
qui est arrivé entre-temps est appliqué.

Ce que le navigateur garde : l'URL du Bridge, un identifiant de joueur pseudonyme et une capacité qui ne peut que lire
et accuser réception des signaux de ce jeu, sous `<jeu>:reality-link` dans le localStorage. Jamais écrits dans une
sauvegarde ni une session. Une nouvelle partie sur le même appareil garde le lien.

Les textes de l'interface sont `realityLink`, `realityStart`, `realityCode`, `realityWaiting`, `realityOpen`,
`realityOffline`, `realityRevoked`, `realityNone`, `realitySimulated`, `realityUnlink`, `realityMismatch`,
`realityRelink` dans le `ui` du jeu (valeurs anglaises par défaut dans `src/engine/dom/reality-ui.ts`).

Le joueur vérifie chaque signal avec les clés du Bridge, chacune dans sa fenêtre, et l'expiration d'un signal, avec
cinq minutes de tolérance pour l'horloge de l'appareil (`CLOCK_SKEW_MS` dans `src/engine/reality/protocol.ts`, la
même valeur dans le cross-check Rust). Quand un signal nomme une clé que le trousseau n'a pas (le Bridge a fait
tourner sa clé pendant que le lien était ouvert), le client redemande les clés une fois avant de le refuser.

## Ce que la session et la sauvegarde gardent

Un signal est une entrée de la session (`{ external: { id, sequence, signal, source, receivedAt, playerId } }`) :
`npm run replay` l'applique hors ligne, sans Bridge. La sauvegarde garde la dernière séquence reçue sans trou et les
ids au-delà (`GameState.reality`) : un signal livré de nouveau (le Bridge livre au moins une fois) est reconnu et pas
appliqué deux fois.

Le premier signal lie la sauvegarde à son joueur pseudonyme (`GameState.reality.playerId`, le `p-…` donné par le
Bridge à la liaison ; jamais la capacité). Une sauvegarde qui arrive sur un appareil lié comme quelqu'un d'autre
(importée d'un autre appareil, ou faite avant un « Délier » puis une nouvelle liaison) est une **discordance**
(`mismatch`) : rien n'en est appliqué ni acquitté, la partie continue, et le « Lien au monde » du menu pause propose
d'utiliser le lien de cet appareil avec cette sauvegarde ; son état de lien repart alors pour ce joueur (curseur 0),
et les signaux dont la sauvegarde a déjà l'effet ne sont pas appliqués de nouveau. Les mondes du solveur ne nomment
aucun joueur : ils ne lient rien.

## L'API

`web-scumm/reality` (`docs/fr/API.md`) : le signal signé et sa vérification, le client et son transport HTTP, le
simulateur, le manifeste. Un jeu avec son propre transport implémente `WorldSignalPort`.
