# Architecture — Barbu en ligne

Voir les règles dans [`regles.md`](./regles.md).

## Objectifs produit

Deux modes de jeu, un seul moteur, derrière un **compte obligatoire** :

1. **Online** — 4 joueurs distants, temps réel, serveur autoritaire.
2. **Solo** — 1 humain vs 3 bots, 100 % côté client (aucun serveur).

**Comptes** : l'app s'ouvre sur connexion/inscription (pseudo + mot de passe). Le compte est
l'identité unique du joueur (pseudo + avatar), utilisée partout, notamment en ligne. Il n'y a plus
de profils locaux ni de mode arbitre (suivi d'une partie physique) : voir l'historique Git pour
l'ancienne implémentation.

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

### Online (serveur autoritaire) — **Cloudflare Workers (partyserver)**
Implémenté dans le workspace **`apps/party/`**. Une salle = une **Durable Object** Cloudflare.
Toute la logique vit dans `src/core.ts` (`GameRoom`, agnostique du transport) ; `src/server.ts`
est un mince adaptateur [`partyserver`](https://github.com/cloudflare/partykit) (le successeur
officiel de PartyKit) qui relie les entrées `onConnect/onMessage/onClose` à `GameRoom` et expose
le point d'entrée Worker (`routePartykitRequest`). Le client est dans `apps/web/src/online/`
(`useOnlineGame` + `partysocket`).
- Salon par **code à 4 lettres** = l'id (`name`) de la Durable Object.
- Le serveur détient l'unique `MatchState`. Le client envoie une `Action`, le serveur valide
  via le réducteur (`applyMatchAction`) et diffuse à chacun une **vue caviardée**
  (`redactState`, dans le moteur : main propre complète, mains adverses = `handSizes`).
- Transport **WebSocket** via une Durable Object (non-hibernante : l'état vit en mémoire tant
  qu'il y a des connexions). Reconnexion par `profileId` : le joueur récupère son siège ; en
  attendant, un bot le remplace pour ne pas bloquer la partie.
- **Sièges configurés par l'hôte** : chaque place vide est ouverte (pour un ami) ou tenue par
  un bot (niveau au choix) via `autoAction` — même moteur que le solo.
- Vues, messages et types partagés : `packages/engine/src/online.ts`
  (`RedactedMatchState`, `SeatInfo`, `ClientMsg`, `ServerMsg`, `MancheLog`).
- Rendu : le mode en ligne réutilise le composant de table du solo
  (`apps/web/src/game/GameTable.tsx`), le siège local étant toujours affiché en bas.

### Comptes (auth serveur)
Même Worker que le jeu en ligne. Une **Durable Object globale** (`AuthServer`, name `global`,
stockage SQLite : tables `accounts` + `sessions`) tient les comptes. La logique
(`apps/party/src/auth.ts`, `AuthLogic` sur une abstraction `AuthDB`) est agnostique du runtime →
testée sans Durable Object (impl `AuthDB` en mémoire). Mots de passe hachés en **PBKDF2-SHA256**
(WebCrypto). Endpoints JSON (avec CORS) exposés par le `fetch` racine : `POST /auth/register`,
`/auth/login`, `/auth/logout`, `/auth/profile` (Bearer), `GET /auth/me`. Côté client
(`apps/web/src/auth/`) : `useAuth` garde le **token** en `localStorage` et le revalide au démarrage
(`/auth/me`) ; `AuthScreen` gère connexion/inscription ; `SettingsScreen` = « Mon compte » (avatar,
pseudo, déconnexion).

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
| Serveur online | Cloudflare Workers + partyserver (Durable Objects) | salles temps réel, serveur autoritaire, TS, déployé sur ton propre compte |
| Comptes | Durable Object SQLite + WebCrypto (PBKDF2) | même Worker, aucune base externe, gratuit, mots de passe hachés |
| Tests | Vitest | moteur = cœur à tester (scoring, légalité) |

## Ordre de construction proposé

1. **Moteur** : types, cards, contracts, scoring (+ tests Vitest) — cœur de valeur.
2. **Réducteurs** trickRound + reussiteRound + contre.
3. **Solo** (web) : valide le moteur en conditions réelles avec bots v1.
4. **Online** : serveur Cloudflare Workers (partyserver) + salons + caviardage.
5. **Comptes** : auth serveur (même Worker) + écran de connexion.
6. **Bots v2** + polish UI.

## Lancer & déployer le mode en ligne (Cloudflare Workers)

En développement (deux terminaux) :

```bash
# 1) le serveur de jeu (Durable Object), sur 127.0.0.1:8787
npm run dev --workspace=@barbu/party        # = wrangler dev

# 2) le front, qui s'y connecte par défaut en local
npm run dev --workspace=@barbu/web
```

Ouvrir deux onglets, « En ligne », créer une partie, partager le code (ou le lien `?room=CODE`).

En production, GitHub Pages est **statique** : le serveur Worker se déploie **à part**, sur ton
propre compte Cloudflare (gratuit, Durable Objects SQLite inclus ; une seule fois) :

```bash
npx wrangler login                                   # auth Cloudflare (navigateur)
npm run deploy --workspace=@barbu/party              # = wrangler deploy  → barbu.<sous-domaine>.workers.dev
```

Puis renseigner l'hôte pour le build Pages : dépôt → **Settings → Secrets and variables →
Actions → Variables** → `PARTYKIT_HOST = barbu.<sous-domaine>.workers.dev`. Le workflow
`deploy.yml` l'injecte dans `VITE_PARTYKIT_HOST`. Sans variable, le mode en ligne pointe sur
`127.0.0.1:8787` (dev local uniquement).

> Note : `apps/party/worker-configuration.d.ts` (types runtime générés par `wrangler types`)
> est régénéré automatiquement au `typecheck` et ignoré par git.
