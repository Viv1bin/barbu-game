# Règles du Barbu

Version famille Gautron — référence pour le moteur de jeu.

## Objectif

Avoir **le moins de points possible** à la fin de la partie. La plupart des contrats donnent des points de pénalité (à éviter) ; la Réussite donne des points négatifs (bonus).

## Matériel & joueurs

- **4 joueurs**, jeu de **52 cartes** (pas de joker).
- Ordre des cartes (fort → faible) : **As > Roi > Dame > Valet > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2**.

## Structure d'une partie

- Chaque joueur est donneur **une fois par contrat**.
- 4 donneurs × 7 contrats = **28 manches** au total.
- Le donneur **choisit librement** le contrat qu'il veut jouer (parmi ceux qu'il n'a pas encore donnés).
- Après distribution, le donneur **commence le premier tour de table**.

## Mécanique commune à tous les contrats à plis

Concerne tous les contrats **sauf la Réussite** (qui a sa propre mécanique).

- Le premier joueur d'un pli pose une carte ; les autres jouent **à tour de rôle** dans le sens du jeu.
- **Obligation de fournir** la couleur demandée (celle de la première carte du pli).
- Si un joueur n'a pas la couleur : il **défausse** n'importe quelle carte (pas d'obligation de couper).
- Le pli est remporté par la **carte la plus forte de la couleur demandée**. Une défausse ne peut jamais gagner un pli.
- Le gagnant du pli entame le pli suivant.

### Contrats « cœur » (restriction d'ouverture)

Les contrats marqués **(cœur)** : on ne peut pas **entamer** (jouer en première carte d'un pli) avec un cœur, **sauf** si on n'a plus que des cœurs en main.
Concernés : **Barbu, Cœur, Salade**.

## Les 7 contrats

| Contrat | Type | Pénalité |
|---|---|---|
| Barbu | (cœur) | 80 pts le Roi de cœur, puis la manche s'arrête |
| Cœur | (cœur) | 10 pts par cœur |
| 2 der | plis | 20 pts avant-dernier pli, 60 pts dernier pli |
| Dames | plis | 20 pts par Dame |
| Plis | plis | 10 pts par pli remporté |
| Salade | (cœur) | cumul des 5 contrats précédents, valeurs ÷2 (total 250) |
| Réussite | spécial | 1er : −120, 2e : −60, 3e : −20, 4e : 0 |

### Détail

**Barbu (cœur)** — 80 pts à celui qui remporte le pli contenant le **Roi de cœur**. Dès que le Roi de cœur tombe, **la manche se termine** immédiatement.

**Cœur (cœur)** — 10 pts par cœur remporté dans ses plis. Le Roi de cœur **ne vaut que 10 pts** ici (pas de bonus Barbu). Total = 13 cœurs × 10 = 130 pts.

**2 der** — Seuls les **2 derniers plis** comptent : avant-dernier = 20 pts, dernier = 60 pts. Tous les autres plis = 0. Total = 80 pts.

**Dames** — 20 pts par **Dame** remportée. Total = 4 × 20 = 80 pts.

**Plis** — 10 pts par **pli** remporté. Total = 13 × 10 = 130 pts.

**Salade (cœur)** — Cumule **tous** les contrats à pénalité précédents en même temps, chaque valeur **divisée par 2** :
- Barbu (Roi de cœur) : 40
- chaque cœur : 5
- avant-dernier pli : 10 / dernier pli : 30
- chaque Dame : 10
- chaque pli : 5

Une carte cumule tous ses effets. Exemples de layering :
- **Roi de cœur** = cœur (5) + Barbu (40) = **45**
- **Dame de cœur** = cœur (5) + Dame (10) = 15
Total de la manche = **250 pts**.
> Note : contrairement au Barbu, la manche **ne s'arrête pas** quand le Roi de cœur tombe (on joue les 13 plis).

**Réussite (spécial)** — voir section dédiée ci-dessous.

## Contre (doublement)

- Quand le donneur **annonce** le contrat, chaque autre joueur dit, **à tour de rôle**, s'il **contre le donneur** ou non.
- Un contre est un pari 1-contre-1 : le joueur affirme qu'il fera **mieux** (moins de points) que le donneur sur cette manche.
- **Résolution** en fin de manche, pour chaque joueur ayant contré. Soit `E = mes_points − points_donneur`. On applique :
  - au contreur : `+ E`
  - au donneur : `− E` (via le miroir : le donneur reçoit `points_donneur − mes_points` pour ce contre)

Chaque joueur ajoute donc `(ses points − points de l'adversaire)` à son propre score.

**Exemple** — Marc contre Julien (donneur). Fin de manche : Julien 20 pts, Marc 40 pts.
- Julien = 20 + (20 − 40) = **0**
- Marc = 40 + (40 − 20) = **60**

Si plusieurs joueurs contrent, chaque contre se résout indépendamment contre le donneur.

## Réussite (mécanique détaillée)

Jeu de type « pose en file », mécanique différente des plis.

- Le donneur (celui qui a choisi le contrat) choisit une **hauteur** (un rang, ex : les 7).
- Les cartes se posent au centre en **4 files** (une par couleur), remplies **du 2 jusqu'à l'As** dans l'ordre.
- À son tour, un joueur **doit** faire l'une de ces actions s'il le peut :
  - **ouvrir une nouvelle couleur** en posant une carte de la hauteur choisie, ou
  - **prolonger une file existante** en respectant l'ordre des cartes (2 → As).
- **On ne peut pas passer si on peut jouer.**
- Poser un **As** (fin d'une file) donne le droit de **rejouer** aussitôt (ou de s'arrêter au choix).
- Si un joueur n'a **aucune** carte jouable, il **passe**.
- **Classement** = ordre dans lequel les joueurs se débarrassent de **toutes** leurs cartes.

**Score** : 1er → **−120**, 2e → **−60**, 3e → **−20**, 4e (dernier) → **0**.

Le contre s'applique aussi à la Réussite, avec la même formule d'écart (les points peuvent être négatifs).

## Fin de partie

Après les 28 manches, on additionne les scores de chaque joueur (contres inclus). **Le plus petit total gagne.**
