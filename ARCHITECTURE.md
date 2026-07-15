# Architecture — Barbu en ligne

Voir les règles dans [`regles.md`](./regles.md).

## Objectifs produit

Trois modes, un seul moteur de jeu :

1. **Online** — 4 joueurs distants, temps réel, serveur autoritaire.
2. **Local (arbitre)** — compagnon d'une vraie partie physique : on saisit le résultat des plis, l'app calcule points + contres. But = compte de points fiable.
3. **Solo** — 1 humain vs 3 bots, 100 % côté client (aucun serveur).

## Principe directeur

> **Un moteur pur, trois hôtes.**

Le moteur (`packages/engine`) est du TypeScript **pur, déterministe, sans dépendance** : un réducteur `(state, action) → state`. Le même code tourne :
- **côté serveur** pour le mode online (autorité, anti-triche),
- **côté client** pour le solo et les bots,
- **partiellement** pour le mode arbitre (uniquement scoring + contres).

## Monorepo (npm workspaces)

```
barbu/
├── package.json            # workspaces: packages/*, apps/*
├── tsconfig.base.json
├── regles.md
├── ARCHITECTURE.md
├── packages/
│   └── engine/             # moteur pur (0 dépendance runtime)
│       ├── src/
│       │   ├── types.ts        # Card, Contract, GameState, Action…
│       │   ├── cards.ts        # deck, tri, comparaison, distribution
│       │   ├── contracts.ts    # métadonnées des 7 contrats
│       │   ├── trickRound.ts   # réducteur contrats à plis
│       │   ├── reussiteRound.ts# réducteur Réussite
│       │   ├── scoring.ts      # scoring par contrat (fonctions pures)
│       │   ├── contre.ts       # résolution des contres
│       │   ├── match.ts        # orchestration 28 manches + dealer
│       │   ├── bots.ts         # interface Bot + bot heuristique
│       │   └── index.ts
│       └── package.json
└── apps/
    ├── web/                # Vite + React + TS (client des 3 modes)
    │   └── src/
    │       ├── modes/{online,local,solo}/
    │       ├── game/       # rendu table, cartes, plis, réussite
    │       ├── net/        # client WebSocket (mode online)
    │       └── state/      # store UI (Zustand)
    └── server/             # Node + ws (mode online, autoritaire)
        └── src/
            ├── rooms.ts    # salons, matchmaking simple par code
            ├── session.ts  # 1 partie = 1 instance moteur
            ├── protocol.ts # messages client↔serveur (partagés)
            └── redact.ts   # filtrage info cachée par joueur
```

## Modèle de données (moteur)

```ts
type Suit = 'H' | 'S' | 'D' | 'C';           // Cœur, Pique, Carreau, Trèfle
type Rank = 2..14;                            // 11=V 12=D 13=R 14=As
type Card = { suit: Suit; rank: Rank };
type PlayerId = 0 | 1 | 2 | 3;

type ContractId =
  | 'BARBU' | 'COEUR' | 'DEUXDER' | 'DAMES'
  | 'PLIS'  | 'SALADE' | 'REUSSITE';

// État d'une manche à plis
interface TrickRoundState {
  contract: ContractId;
  hands: Card[][];              // 4 mains
  leader: PlayerId;             // qui entame le pli courant
  currentTrick: { player: PlayerId; card: Card }[];
  trickCount: number;           // plis déjà joués (pour "2 der")
  wonCards: Card[][];           // cartes gagnées par joueur (scoring)
  finished: boolean;
  heartsBroken: boolean;        // cœur déjà défaussé/joué (contrats cœur)
}

// État d'une manche Réussite
interface ReussiteState {
  rank: Rank;                   // hauteur choisie
  files: Record<Suit, { low: Rank; high: Rank } | null>; // extension par couleur
  hands: Card[][];
  turn: PlayerId;
  finishOrder: PlayerId[];      // ordre de sortie → classement
  finished: boolean;
}

// Orchestration globale
interface MatchState {
  dealer: PlayerId;
  playedContracts: ContractId[];     // par donneur → 28 manches
  phase: 'CHOOSE_CONTRACT' | 'CONTRE' | 'PLAY' | 'SCORING' | 'DONE';
  contres: { by: PlayerId }[];       // contres du donneur pour la manche
  round: TrickRoundState | ReussiteState | null;
  scores: number[];                  // cumul 4 joueurs
}
```

## Actions (entrée du réducteur)

```ts
type Action =
  | { t: 'CHOOSE_CONTRACT'; contract: ContractId }   // donneur
  | { t: 'CONTRE'; player: PlayerId; contre: boolean }
  | { t: 'PLAY_CARD'; player: PlayerId; card: Card }  // contrats à plis
  | { t: 'REUSSITE_PLAY'; player: PlayerId; card: Card }
  | { t: 'REUSSITE_PASS'; player: PlayerId };
```

Le réducteur **valide chaque action** (tour du bon joueur, coup légal : fournir la couleur, restriction cœur, ordre Réussite, interdiction de passer si on peut jouer). Un coup illégal → erreur, état inchangé.

## Scoring (fonctions pures)

Une fonction par contrat, signature `(round) → number[]` (points des 4 joueurs) :

- `BARBU` : 80 au gagnant du pli du Roi de cœur ; manche stoppée dès qu'il tombe.
- `COEUR` : 10 × cœurs gagnés (Roi de cœur = 10, pas de bonus).
- `DEUXDER` : 20 (avant-dernier pli) + 60 (dernier pli).
- `DAMES` : 20 × dames gagnées.
- `PLIS` : 10 × plis gagnés.
- `SALADE` : somme des 5 contrats ci-dessus, valeurs ÷2 (cartes cumulent leurs effets ; total 250).
- `REUSSITE` : selon `finishOrder` → [−120, −60, −20, 0].

Puis **`contre.ts`** applique les écarts : pour chaque contreur, `E = points_contreur − points_donneur`, ajouté au contreur et retranché au donneur.

## Modes — implémentation

### Solo (client-only)
Store UI détient le `MatchState`. Les 3 bots appellent `bot.chooseAction(view, id)` (info cachée respectée : un bot ne voit que sa main). Boucle : action humaine → réducteur → si prochain joueur = bot, jouer, répéter.

### Online (serveur autoritaire)
- Salon par **code à 4 lettres** (`rooms.ts`).
- Le serveur détient l'unique `MatchState`. Client envoie une `Action`, serveur valide via le réducteur, diffuse à chacun une **vue caviardée** (`redact.ts` : main propre complète, mains adverses = nombre de cartes).
- Transport **WebSocket** (`ws`). Reconnexion : le serveur renvoie la vue courante.
- Bots optionnels pour compléter une table incomplète (même interface `Bot`).

### Local (arbitre / compte de points)
Un seul appareil, aucune main gérée. Écrans de saisie par contrat :
- contrats à plis : on désigne le gagnant de chaque pli + cartes pertinentes (cœurs, dames, Roi de cœur) → `scoring.ts`.
- Réussite : on saisit l'ordre d'arrivée.
- contres : cases à cocher avant la manche → `contre.ts`.
Réutilise **uniquement** `scoring.ts` + `contre.ts` (pas les réducteurs de jeu). Tableau des scores cumulés sur les 28 manches.

## Protocole réseau (online)

Client → Serveur : `JOIN {code,name}`, `ACTION {action}`, `LEAVE`.
Serveur → Client : `VIEW {redactedState}`, `ERROR {msg}`, `LOBBY {players}`.

## Bots

Interface `Bot { chooseAction(view: PlayerView, id: PlayerId): Action }`.
- **v1** : coup légal aléatoire (baseline jouable).
- **v2** : heuristiques par contrat (ex. se défausser des cœurs hauts en contrat Cœur, garder les basses pour ne pas prendre les plis).
- Interface stable → amélioration sans toucher au reste.

## Stack & outils

| Couche | Choix | Pourquoi |
|---|---|---|
| Langage | TypeScript strict | sûreté, moteur partagé |
| Monorepo | npm workspaces | natif (npm 11), zéro install |
| Moteur | TS pur, 0 dép. | testable, réutilisable partout |
| Front | Vite + React | rapide, SPA |
| État UI | Zustand | léger, simple |
| Serveur | Node + `ws` | WebSocket minimal, autoritaire |
| Tests | Vitest | moteur = cœur à tester (scoring, légalité) |

## Ordre de construction proposé

1. **Moteur** : types, cards, contracts, scoring (+ tests Vitest) — cœur de valeur.
2. **Réducteurs** trickRound + reussiteRound + contre.
3. **Solo** (web) : valide le moteur en conditions réelles avec bots v1.
4. **Local (arbitre)** : rapide car réutilise scoring — utilisable en vraie partie tôt.
5. **Online** : serveur ws + salons + caviardage.
6. **Bots v2** + polish UI.
