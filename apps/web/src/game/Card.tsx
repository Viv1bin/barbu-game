import type { Card } from '@barbu/engine';
import { SUIT_RED, SUIT_SYMBOL, rankLabel } from '../format.js';

export type CardSize = 'sm' | 'md' | 'lg';

/**
 * Carte à jouer « visuelle » : rang **et** petit symbole de couleur dans les
 * coins, plus le grand symbole au centre. En éventail serré on ne voit que la
 * tranche gauche de chaque carte : le symbole du centre y est masqué, seul le
 * coin dit à quoi on a affaire — il lui faut donc la couleur, pas juste le rang.
 * Purement présentationnel — l'interactivité (bouton) est gérée par l'appelant.
 */
export function PlayingCard({
  card,
  size = 'md',
  className = '',
}: {
  card: Card;
  size?: CardSize;
  className?: string;
}) {
  const red = SUIT_RED[card.suit];
  const r = rankLabel(card.rank);
  const s = SUIT_SYMBOL[card.suit];
  return (
    <span className={`pcard ${size} ${red ? 'red' : 'black'} ${className}`} aria-label={`${r}${s}`}>
      <span className="corner tl">{r}<i className="csuit">{s}</i></span>
      <span className="pip">{s}</span>
      <span className="corner br">{r}<i className="csuit">{s}</i></span>
    </span>
  );
}

/** Dos de carte, pour les compteurs de main. */
export function CardBack({ size = 'sm', className = '' }: { size?: CardSize; className?: string }) {
  return <span className={`pcard back ${size} ${className}`} aria-hidden="true" />;
}
