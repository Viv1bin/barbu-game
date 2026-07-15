import { ALL_CONTRACTS, type ContractId } from '@barbu/engine';
import type { MatchRecord, Profile, Store } from './store.js';

export interface ContractStat {
  contract: ContractId;
  /** Nb de manches de ce contrat jouées (tous donneurs confondus). */
  played: number;
  /** Points moyens encaissés par manche de ce contrat. Bas = bon. */
  avg: number;
}

export interface RivalStat {
  id: string;
  name: string;
  avatar: string;
  /** Parties jouées ensemble. */
  games: number;
  /** Parties où le rival a fini devant. */
  lost: number;
  /** Écart moyen (rivalScore − monScore). Négatif = il me bat. */
  margin: number;
}

export interface PlayerStats {
  games: number;
  wins: number;
  winRate: number;
  podiums: number;
  avgScore: number;
  bestScore: number | null;
  worstScore: number | null;
  /** Écart-type des scores finaux : régularité. Bas = constant. */
  deviation: number;
  /** Écart moyen (moyenne des 3 autres − mon score). Positif = je bats la table. */
  margin: number;
  bestContract: ContractStat | null;
  worstContract: ContractStat | null;
  contracts: ContractStat[];
  contresPlayed: number;
  contresWon: number;
  contreRate: number;
  worstRival: RivalStat | null;
  rivals: RivalStat[];
  /** Note globale 0–100. */
  level: number;
  levelLabel: string;
  /** false tant que < 3 parties : la note est indicative. */
  reliable: boolean;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function levelLabel(level: number): string {
  if (level >= 85) return 'Maître';
  if (level >= 70) return 'Expert';
  if (level >= 55) return 'Confirmé';
  if (level >= 40) return 'Amateur';
  return 'Débutant';
}

/** Parties du store où ce profil a joué, avec son siège. */
function matchesOf(store: Store, id: string): { match: MatchRecord; seat: number }[] {
  const out: { match: MatchRecord; seat: number }[] = [];
  for (const match of store.matches) {
    const seat = match.seats.indexOf(id);
    if (seat >= 0 && match.scores.length === 4) out.push({ match, seat });
  }
  return out;
}

export function computeStats(store: Store, id: string): PlayerStats {
  const mine = matchesOf(store, id);
  const finals = mine.map(({ match, seat }) => match.scores[seat]!);

  let wins = 0;
  let podiums = 0;
  const margins: number[] = [];
  for (const { match, seat } of mine) {
    const my = match.scores[seat]!;
    const others = match.scores.filter((_, i) => i !== seat);
    // Au Barbu, le moins de points gagne.
    const rank = 1 + others.filter((o) => o < my).length;
    if (rank === 1) wins++;
    if (rank <= 2) podiums++;
    margins.push(mean(others) - my);
  }

  // --- Par contrat : points encaissés par manche ---
  const byContract = new Map<ContractId, number[]>();
  // --- Contres tentés / réussis ---
  let contresPlayed = 0;
  let contresWon = 0;
  for (const { match, seat } of mine) {
    for (const m of match.history) {
      const pts = m.points[seat];
      if (pts === undefined) continue;
      const arr = byContract.get(m.contract) ?? [];
      arr.push(pts);
      byContract.set(m.contract, arr);
      if (m.contres.includes(seat as 0 | 1 | 2 | 3) && seat !== m.dealer) {
        contresPlayed++;
        // Contre réussi : le contreur finit la manche avec moins de points que le donneur.
        if (pts < m.points[m.dealer]!) contresWon++;
      }
    }
  }
  const contracts: ContractStat[] = ALL_CONTRACTS.map((contract) => {
    const xs = byContract.get(contract) ?? [];
    return { contract, played: xs.length, avg: mean(xs) };
  });
  const rated = contracts.filter((c) => c.played > 0);
  const bestContract = rated.length ? rated.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;
  const worstContract = rated.length ? rated.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;

  // --- Rivaux ---
  const rivalAcc = new Map<string, { games: number; lost: number; diffs: number[] }>();
  for (const { match, seat } of mine) {
    const my = match.scores[seat]!;
    match.seats.forEach((rid, i) => {
      if (i === seat || !rid) return;
      const acc = rivalAcc.get(rid) ?? { games: 0, lost: 0, diffs: [] };
      acc.games++;
      if (match.scores[i]! < my) acc.lost++;
      acc.diffs.push(match.scores[i]! - my);
      rivalAcc.set(rid, acc);
    });
  }
  const rivals: RivalStat[] = [...rivalAcc.entries()]
    .map(([rid, acc]) => {
      const p: Profile | undefined = store.profiles.find((x) => x.id === rid);
      return {
        id: rid,
        name: p?.name ?? 'Inconnu',
        avatar: p?.avatar ?? '👤',
        games: acc.games,
        lost: acc.lost,
        margin: mean(acc.diffs),
      };
    })
    .sort((a, b) => a.margin - b.margin);
  // Pire adversaire : celui qui me bat le plus souvent, départage par écart.
  const worstRival =
    rivals.length === 0
      ? null
      : rivals.reduce((a, b) => {
          const ra = a.lost / a.games;
          const rb = b.lost / b.games;
          if (rb !== ra) return rb > ra ? b : a;
          return b.margin < a.margin ? b : a;
        });

  const games = mine.length;
  const winRate = games ? wins / games : 0;
  const avgMargin = mean(margins);
  // Note : 50 = niveau moyen d'une table. Victoires (poids fort) + marge (poids faible).
  const level = games
    ? Math.max(0, Math.min(100, 50 + 40 * ((winRate - 0.25) / 0.75) + 10 * Math.tanh(avgMargin / 120)))
    : 50;

  return {
    games,
    wins,
    winRate,
    podiums,
    avgScore: mean(finals),
    bestScore: finals.length ? Math.min(...finals) : null,
    worstScore: finals.length ? Math.max(...finals) : null,
    deviation: stdev(finals),
    margin: avgMargin,
    bestContract,
    worstContract,
    contracts,
    contresPlayed,
    contresWon,
    contreRate: contresPlayed ? contresWon / contresPlayed : 0,
    worstRival,
    rivals,
    level,
    levelLabel: levelLabel(level),
    reliable: games >= 3,
  };
}
