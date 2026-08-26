import { useState } from 'react';
import { MIN_PASSWORD_LENGTH, type Card, type Suit } from '@barbu/engine';
import { AVATARS } from '../auth/avatars.js';
import { ApiError, type Auth } from '../auth/useAuth.js';
import { SUIT_RED, SUIT_SYMBOL } from '../format.js';
import { PlayingCard } from '../game/Card.js';
import { sortHand, useCardSort, type CardSortPref } from '../game/cardSort.js';
import { useSavedGames } from '../social/useSavedGame.js';
import { SavedGamesList } from '../solo/SavedGamesList.js';

/** Écran « Mon compte » : profil, tri des cartes, parties solo, session. */
export function SettingsScreen({
  onBack,
  auth,
  onResumeGame,
}: {
  onBack: () => void;
  auth: Auth;
  onResumeGame: (id: string) => void;
}) {
  const me = auth.account;
  const [pseudo, setPseudo] = useState(me?.pseudo ?? '');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!me) return null;

  const run = async (patch: { pseudo?: string; avatar?: string }, okMsg: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await auth.updateProfile(patch);
      setNotice(okMsg);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  };

  const pseudoDirty = pseudo.trim() !== me.pseudo && pseudo.trim().length >= 2;

  return (
    <div className="app">
      <header>
        <div className="topbar">
          <button className="ghost" onClick={onBack}>← Menu</button>
          <h1>Mon compte <span className="mode">profil, cartes, parties</span></h1>
        </div>
      </header>

      <main className="settings-main">
        <div className="panel">
          <div className="panelhead">
            <h3>
              <span className="avatar">{me.avatar}</span> {me.pseudo}
            </h3>
          </div>

          <div className="field">
            <label>Avatar</label>
            <div className="avatars">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  className={`avatarpick ${a === me.avatar ? 'on' : ''}`}
                  disabled={busy}
                  onClick={() => a !== me.avatar && run({ avatar: a }, 'Avatar mis à jour.')}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Pseudo</label>
            <div className="inlinerow">
              <input value={pseudo} maxLength={18} autoCapitalize="none" onChange={(e) => setPseudo(e.target.value)} />
              <button disabled={!pseudoDirty || busy} onClick={() => run({ pseudo: pseudo.trim() }, 'Pseudo mis à jour.')}>
                Renommer
              </button>
            </div>
          </div>

          {error && <p className="errline">{error}</p>}
          {notice && <p className="okline">{notice}</p>}
        </div>

        <CardSortPanel />

        <MyGamesPanel token={auth.token} onResume={onResumeGame} />

        <PasswordPanel auth={auth} />

        <div className="panel">
          <div className="danger-zone">
            <p>Se déconnecter de ce navigateur. Ton compte et tes données restent sur le serveur.</p>
            <button className="danger" onClick={auth.logout}>Se déconnecter</button>
          </div>
        </div>
      </main>
    </div>
  );
}

// --- Tri des cartes --------------------------------------------------------

// Main d'exemple pour la prévisualisation du tri (2 cartes par couleur).
const SAMPLE: Card[] = (['S', 'H', 'C', 'D'] as Suit[]).flatMap((suit) => [
  { suit, rank: 14 },
  { suit, rank: 7 },
]);

function CardSortPanel() {
  const [pref, setPref] = useCardSort();

  const setSide = (strongSide: CardSortPref['strongSide']) => setPref({ ...pref, strongSide });
  const move = (i: number, dir: -1 | 1) => {
    const order = [...pref.suitOrder];
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    setPref({ ...pref, suitOrder: order });
  };

  return (
    <div className="panel">
      <div className="panelhead"><h3>Tri des cartes</h3></div>
      <p className="muted">Comment ta main est rangée automatiquement pendant les parties.</p>

      <div className="field">
        <label>Sens du rang (dans chaque couleur)</label>
        <div className="tabs">
          <button className={pref.strongSide === 'left' ? 'on' : 'ghost'} onClick={() => setSide('left')}>Fort à gauche</button>
          <button className={pref.strongSide === 'right' ? 'on' : 'ghost'} onClick={() => setSide('right')}>Fort à droite</button>
        </div>
      </div>

      <div className="field">
        <label>Ordre des couleurs (gauche → droite)</label>
        <div className="suitorder">
          {pref.suitOrder.map((s, i) => (
            <div key={s} className={`suitchip ${SUIT_RED[s] ? 'red' : 'black'}`}>
              <button className="ghost tiny" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Déplacer à gauche">←</button>
              <span className="suitsym">{SUIT_SYMBOL[s]}</span>
              <button className="ghost tiny" disabled={i === pref.suitOrder.length - 1} onClick={() => move(i, 1)} aria-label="Déplacer à droite">→</button>
            </div>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Aperçu</label>
        <div className="sortpreview">
          {sortHand(SAMPLE, pref).map((c) => (
            <PlayingCard key={`${c.suit}${c.rank}`} card={c} size="sm" />
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Mes parties solo ------------------------------------------------------

function MyGamesPanel({ token, onResume }: { token: string | null; onResume: (id: string) => void }) {
  const games = useSavedGames(token);
  return (
    <div className="panel">
      <div className="panelhead"><h3>Mes parties solo</h3></div>
      <p className="muted">Reprends ou supprime tes parties en cours.</p>
      <SavedGamesList
        saves={games.saves}
        loading={games.loading}
        onResume={(id) => onResume(id)}
        onDelete={games.remove}
        empty="Aucune partie solo sauvegardée."
      />
    </div>
  );
}

// --- Mot de passe ----------------------------------------------------------

/** Changement de mot de passe : déconnecte les autres appareils. */
function PasswordPanel({ auth }: { auth: Auth }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = current.length >= 1 && next.length >= MIN_PASSWORD_LENGTH && next === confirm;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await auth.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setNotice('Mot de passe changé. Les autres appareils ont été déconnectés.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panelhead">
        <h3>Mot de passe</h3>
      </div>

      <div className="field">
        <label>Mot de passe actuel</label>
        <input type="password" value={current} autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="field">
        <label>Nouveau mot de passe ({MIN_PASSWORD_LENGTH} caractères min.)</label>
        <input type="password" value={next} autoComplete="new-password" onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="field">
        <label>Confirmer</label>
        <div className="inlinerow">
          <input type="password" value={confirm} autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
          <button disabled={!ready || busy} onClick={submit}>Changer</button>
        </div>
      </div>

      {confirm.length > 0 && next !== confirm && <p className="errline">Les deux saisies diffèrent.</p>}
      {error && <p className="errline">{error}</p>}
      {notice && <p className="okline">{notice}</p>}
    </div>
  );
}
