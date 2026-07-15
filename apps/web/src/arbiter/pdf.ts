import { jsPDF } from 'jspdf';
import { CONTRACT_LABEL } from '../format.js';
import type { ArbiterState } from './useArbiter.js';

const MARGIN = 14;
const ROW_H = 7;

function shorten(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(`${t}.`) > maxWidth) t = t.slice(0, -1);
  return `${t}.`;
}

/** Feuille de scores A4 : tableau manche par manche + cumuls + podium. */
export function exportScoresPdf(state: ArbiterState): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Colonnes : n° | donneur | contrat | contres | 4 joueurs
  const wNum = 10;
  const wDealer = 26;
  const wContract = 22;
  const wContre = 26;
  const rest = pageW - 2 * MARGIN - wNum - wDealer - wContract - wContre;
  const wPlayer = rest / 4;
  const xs = [MARGIN];
  for (const w of [wNum, wDealer, wContract, wContre, wPlayer, wPlayer, wPlayer]) {
    xs.push(xs[xs.length - 1]! + w);
  }

  const ranking = state.names
    .map((name, p) => ({ name, score: state.scores[p]!, seat: p }))
    .sort((a, b) => a.score - b.score);

  // --- En-tête ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Barbu — feuille de scores', MARGIN, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    `${new Date().toLocaleDateString('fr-FR', { dateStyle: 'long' })} · ${state.history.length} manche(s) jouée(s)`,
    MARGIN,
    24,
  );
  doc.setTextColor(0);

  // --- Podium ---
  let y = 34;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Classement (le moins de points gagne)', MARGIN, y);
  y += 5;
  doc.setFontSize(10);
  const medals = ['1er', '2e', '3e', '4e'];
  ranking.forEach((r, i) => {
    doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
    doc.text(`${medals[i]}  ${r.name}`, MARGIN + 2, y);
    doc.text(`${r.score} pts`, MARGIN + 70, y, { align: 'right' });
    y += 5;
  });

  // --- Tableau ---
  y += 4;
  const headerY = y;
  doc.setFillColor(20, 102, 61);
  doc.rect(MARGIN, headerY - 5, pageW - 2 * MARGIN, ROW_H, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const headers = ['#', 'Donneur', 'Contrat', 'Contre(s)', ...state.names];
  headers.forEach((h, i) => {
    const centered = i >= 4;
    const x = centered ? xs[i]! + wPlayer / 2 : xs[i]! + 1.5;
    doc.text(shorten(doc, h, (centered ? wPlayer : xs[i + 1]! - xs[i]!) - 2), x, headerY, {
      align: centered ? 'center' : 'left',
    });
  });
  doc.setTextColor(0);
  doc.setFont('helvetica', 'normal');

  y = headerY + ROW_H;
  const running = [0, 0, 0, 0];

  state.history.forEach((m, i) => {
    if (y > pageH - 24) {
      doc.addPage();
      y = 20;
    }
    if (i % 2 === 1) {
      doc.setFillColor(242, 246, 243);
      doc.rect(MARGIN, y - 5, pageW - 2 * MARGIN, ROW_H, 'F');
    }
    const contres = m.contres.length ? m.contres.map((c) => state.names[c]!).join(', ') : '—';
    doc.setFontSize(8);
    doc.text(String(i + 1), xs[0]! + 1.5, y);
    doc.text(shorten(doc, state.names[m.dealer]!, wDealer - 2), xs[1]! + 1.5, y);
    doc.text(shorten(doc, CONTRACT_LABEL[m.contract], wContract - 2), xs[2]! + 1.5, y);
    doc.text(shorten(doc, contres, wContre - 2), xs[3]! + 1.5, y);
    for (let p = 0; p < 4; p++) {
      running[p]! += m.points[p]!;
      const pts = m.points[p]!;
      doc.setFont('helvetica', pts !== 0 ? 'bold' : 'normal');
      doc.setTextColor(pts > 0 ? 170 : pts < 0 ? 20 : 130, pts > 0 ? 30 : pts < 0 ? 120 : 130, 40);
      doc.text(`${pts > 0 ? '+' : ''}${pts}`, xs[4 + p]! + wPlayer / 2 - 4, y, { align: 'center' });
      doc.setTextColor(150);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.text(`(${running[p]})`, xs[4 + p]! + wPlayer / 2 + 7, y, { align: 'center' });
      doc.setFontSize(8);
      doc.setTextColor(0);
    }
    y += ROW_H;
  });

  // --- Totaux ---
  if (y > pageH - 20) {
    doc.addPage();
    y = 20;
  }
  doc.setFillColor(231, 198, 107);
  doc.rect(MARGIN, y - 5, pageW - 2 * MARGIN, ROW_H, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('TOTAL', xs[0]! + 1.5, y);
  for (let p = 0; p < 4; p++) {
    doc.text(String(state.scores[p]), xs[4 + p]! + wPlayer / 2, y, { align: 'center' });
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(140);
  doc.text('Les points entre parenthèses sont le cumul après la manche.', MARGIN, pageH - 10);

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`barbu-scores-${stamp}.pdf`);
}
