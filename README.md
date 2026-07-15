# Barbu

Le jeu de cartes du Barbu, en web. Un moteur pur, plusieurs hôtes.

**▶ Jouer : https://viv1bin.github.io/barbu-game/**

## Modes

| Mode | État | Description |
| --- | --- | --- |
| **Solo** | ✅ | 1 joueur contre 3 bots (3 niveaux : facile, moyen, difficile). Table de poker animée, 28 manches. |
| **Arbitre** | ✅ | Accompagne une vraie partie autour d'une table : contrats, contres, saisie des résultats, comptage des points, profils et statistiques, export PDF de la feuille de scores. |
| **En ligne** | 🚧 | 4 joueurs à distance, temps réel. Pas encore implémenté. |

## Les règles en bref

4 joueurs, 52 cartes, l'As est fort. Chaque joueur donne les 7 contrats une fois → **28 manches**. Le **moins de points gagne**.

| Contrat | Points |
| --- | --- |
| Barbu | 80 à qui ramasse le Roi de cœur (la manche s'arrête là) |
| Cœur | 10 par cœur ramassé |
| Dames | 20 par dame ramassée |
| Plis | 10 par pli |
| 2 der | 20 pour l'avant-dernier pli, 60 pour le dernier |
| Salade | Les 5 précédents cumulés, divisés par 2 (total 250) |
| Réussite | Jeu de la file : −120 / −60 / −20 / 0 selon l'ordre de sortie |

Le donneur annonce son contrat, les 3 autres peuvent le **contrer**. Un contre est un pari en tête-à-tête : l'écart `points du contreur − points du donneur` est ajouté au contreur et retiré au donneur.

## Architecture

```
packages/engine   @barbu/engine — moteur pur, zéro dépendance runtime.
                  Réducteur (state, action) → state, déterministe (RNG injecté).
                  Règles, scoring, bots, scoring manuel pour l'arbitre.
apps/web          @barbu/web — React 18 + Vite. Solo, arbitre, réglages.
```

Le moteur ne connaît ni React ni le réseau : la même logique sert le solo, l'arbitre, et servira le mode en ligne.

## Données

Profils et historique des parties vivent dans le **localStorage du navigateur**. Rien n'est envoyé sur un serveur, il n'y a pas de compte. Les réglages permettent d'exporter/importer une sauvegarde JSON pour changer de navigateur ou d'appareil.

## Développer

```bash
npm install
npm run dev --workspace=@barbu/web   # http://localhost:5173 (+ accessible sur le LAN)
npm test                             # tests du moteur (vitest)
npm run build                        # typecheck + build de tous les paquets
```

Le déploiement est automatique : chaque push sur `main` lance les tests, build, et publie sur GitHub Pages (`.github/workflows/deploy.yml`).
