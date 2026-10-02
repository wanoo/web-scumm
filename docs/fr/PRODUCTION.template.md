# Plan de production — « <TITRE DU JEU> »

<Un paragraphe : ce qui est livré, quand, pour qui. La priorité unique à laquelle tout le reste se plie, par exemple
« un jeu qu'on peut terminer sans bug, de l'écran titre à la fin, sur les téléphones de la famille ».>

Ce fichier est écrit pour être transmis tel quel à un orchestrateur qui lance des sous-agents en parallèle : chaque
lot de travail (WP) est autonome, possède ses fichiers, et se vérifie lui-même.

**Modèles suggérés par lot**
| Lot | Modèle | Pourquoi |
|---|---|---|
| Changements du moteur, règles partagées, QA finale | le modèle de raisonnement le plus puissant disponible | logique du moteur et arbitrage de dernière minute |
| Transcription de lieux, assets, mini-jeux | un modèle rapide | volumineux mais guidé mot à mot par le storyboard ; validate + solve rattrapent les erreurs |

## 0. Comment l'orchestrateur fait tourner ça
1. Lancer la vague 1 : les lots indépendants en parallèle (moteur, assets, mini-jeux), puis les lots de contenu dès
   que le moteur a livré les ajouts au DSL dont ils ont besoin.
2. Chaque agent reçoit ce fichier, son lot, et le gabarit de prompt du §7. Il touche **uniquement** les fichiers que
   possède son lot. Un besoin hors de son lot va dans son rapport ; il ne le fait pas lui-même.
3. Chaque agent termine par `npm run validate && npm test` (et `npm run solve` pour les lots de contenu) et renvoie
   un rapport court : fait / pas fait / pour un autre lot.
4. Vague 2 : le lot QA démarre quand tout le monde a livré. Il peut corriger n'importe quel fichier, seul.
5. Ordre de vérité en cas de désaccord des sources : `games/<id>/storyboard.json` > les notes du commanditaire > le
   code actuel. Le storyboard a toujours raison sur le texte ; le code n'a raison que sur la technique.

## 1. Sources de vérité (à lire dans cet ordre)
| Fichier | Rôle |
|---|---|
| `games/<id>/storyboard.json` (+ son export Markdown) | tout le scénario : tableaux, cases, répliques, réactions optionnelles, indices, sujets de conversation, répliques de regard |
| `docs/en/CONTENT_GUIDE.md`, `ENGINE.md`, `TOOLS.md` | comment écrire le contenu (DSL), le moteur, les outils |
| `games/<id>/layout/*.json` | placement validé (jamais tapé à la main) |
| `games/<id>/art/<sheet>/` | tous les sprites découpés ; jamais recoupés, jamais supprimés |

## 2. Contraintes non négociables
- <Ce qui ne doit jamais entrer dans le dépôt : lister quoi.>
- Ne jamais supprimer un asset : renommer en `_v1`, `_v2`, garder une sauvegarde.
- <Sensibilités du sujet : personnes qui doivent rester silencieuses, blagues refusées, règles de ton.>
- <Règles de style : longueur des phrases, rythme (normal → normal → normal → absurde), pas de simple négation comme
  solution de facilité.>

## 3. État du projet au <date>
**Fonctionne :** <fonctionnalités du moteur, lieux écrits, objets, personnages, mini-jeux, tests au vert, déploiement
documenté.>
**Manque, par ordre d'importance :** <liste numérotée.>

## 4. Lots de travail
### WP-A · Moteur (`src/engine/**`)
Fichiers possédés : … Livrables : … Vérification : `npm test`, une capture d'écran de lieu par changement visuel.
### WP-B · Contenu (`games/<id>/rooms/**`, `game.ts`, `items.ts`, `cast.ts`)
Découpé par groupes de lieux (B1, B2, B3). Fichiers possédés : … Livrables : chaque case du storyboard transcrite ;
indices ; points de sauvegarde.
Vérification : `npm run validate && npm run solve && npm test`.
### WP-C · Assets (`games/<id>/art/**`, `npm run assets`)
### WP-D · Mini-jeux (`src/engine/minigames/**` ou `games/<id>/minigames/**`)
### WP-E · QA, pré-production, déploiement (vague 2, un seul agent)
Partie complète en e2e avec captures d'écran, corrections, build, déploiement, checklist du §6.

## 5. Ordre et règles de fusion
<Qui attend qui ; un commit par lot ; format du message de commit.>

## 6. Checklist finale avant d'envoyer le lien
- [ ] `npm run validate`, `npm run solve`, `npm test`, `npm run build` tous au vert
- [ ] partie complète en e2e au vert avec captures d'écran relues
- [ ] jouée une fois sur un vrai téléphone, en paysage, avec le son
- [ ] rien de privé dans `dist/` (`npm run audit`)

## 7. Gabarit de prompt pour un sous-agent
```
Tu travailles sur le jeu « <TITRE DU JEU> » (dépôt : <path>). Lis docs/PRODUCTION.md en entier, puis ton lot : WP-<X>.
Tu possèdes exclusivement les fichiers listés dans ton lot ; tu ne changes rien d'autre. Un besoin hors de ton lot va dans ton rapport.
Sources de vérité, dans l'ordre : games/<id>/storyboard.json, les notes du commanditaire, puis le code.
Respecte le §2 sans exception.
Termine par : npm run validate && npm test (et npm run solve pour un lot de contenu).
Renvoie un rapport de 15 lignes maximum : fait / pas fait et pourquoi / ce qu'un autre lot doit faire / commandes de vérification qui sont passées.
```
