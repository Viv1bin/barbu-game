import { useRef, useState } from 'react';
import { DEFAULT_AVATAR, MIN_PASSWORD_LENGTH, isAvatarImage, type Card, type Suit } from '@barbu/engine';
import { ApiError, type Auth } from '../auth/useAuth.js';
import { SUIT_RED, SUIT_SYMBOL } from '../format.js';
import { PlayingCard } from '../game/Card.js';
import { sortHand, useCardSort, type CardSortPref } from '../game/cardSort.js';
import { useSavedGames } from '../social/useSavedGame.js';
import { useSocial } from '../social/useSocial.js';
import { Avatar } from '../ui/Avatar.js';
import { fileToAvatarDataUrl } from '../ui/avatarImage.js';
import { Icon } from '../ui/Icon.js';
import { useHubTab } from '../ui/useHubTab.js';
import { SavedGamesList } from '../solo/SavedGamesList.js';

type Tab = 'account' | 'stats' | 'cards' | 'games';

/**
 * Onglet « Profil ». Même structure que l'onglet Amis : en-tête, barre
 * d'onglets, puis une zone de contenu à hauteur minimale pour que la barre ne
 * bouge pas quand on change de section.
 */
export function SettingsScreen({
  auth,
  onResumeGame,
}: {
  auth: Auth;
  onResumeGame: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('account');
  const pick = useHubTab(setTab);
  const me = auth.account;
  if (!me) return null;

  return (
    <div className="hub">
      <div className="hubhead">
        <h2>Mon profil</h2>
      </div>

      <div className="tabs socialtabs">
        <button className={tab === 'account' ? 'on' : 'ghost'} onClick={() => pick('account')}>Compte</button>
        <button className={tab === 'stats' ? 'on' : 'ghost'} onClick={() => pick('stats')}>Stats</button>
        <button className={tab === 'cards' ? 'on' : 'ghost'} onClick={() => pick('cards')}>Cartes</button>
        <button className={tab === 'games' ? 'on' : 'ghost'} onClick={() => pick('games')}>Parties</button>
      </div>

      <div className="tabpane stack">
        {tab === 'account' && (
          <>
            <AccountPanel auth={auth} />
            <PasswordPanel auth={auth} />
            <div className="panel">
              <div className="danger-zone">
                <p>Se déconnecter de ce navigateur. Ton compte et tes données restent sur le serveur.</p>
                <button className="danger" onClick={auth.logout}><Icon name="logout" size={16} />Se déconnecter</button>
              </div>
            </div>
            <DeletePanel auth={auth} />
          </>
        )}
        {tab === 'stats' && <StatsPanel token={auth.token} />}
        {tab === 'cards' && <CardSortPanel />}
        {tab === 'games' && <MyGamesPanel token={auth.token} onResume={onResumeGame} />}
      </div>
    </div>
  );
}

// --- Compte : photo de profil et pseudo ------------------------------------

function AccountPanel({ auth }: { auth: Auth }) {
  const me = auth.account!;
  const [pseudo, setPseudo] = useState(me.pseudo);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await auth.updateProfile({ avatar: dataUrl });
      setNotice('Photo de profil mise à jour.');
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Image illisible.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const pseudoDirty = pseudo.trim() !== me.pseudo && pseudo.trim().length >= 2;
  const hasPhoto = isAvatarImage(me.avatar);

  return (
    <div className="panel">
      <div className="avatarhero">
        <Avatar name={me.avatar} size="xl" />
        <div className="ah-actions">
          <button disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={16} />{hasPhoto ? 'Changer la photo' : 'Ajouter une photo'}
          </button>
          {hasPhoto && (
            <button className="ghost" disabled={busy} onClick={() => run({ avatar: DEFAULT_AVATAR }, 'Photo retirée.')}>
              Retirer
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          className="hiddenfile"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => void pickPhoto(e.target.files?.[0])}
        />
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
  );
}

// --- Mes statistiques ------------------------------------------------------

/** Bloc statistiques perso (déplacé depuis l'onglet Amis). */
function StatsPanel({ token }: { token: string | null }) {
  const social = useSocial(token);
  const stats = social.stats;
  const rate = stats.games ? Math.round((stats.wins / stats.games) * 100) : 0;
  const avg = stats.games ? Math.round(stats.totalPoints / stats.games) : 0;
  const cards: { label: string; value: string | number }[] = [
    { label: 'Parties jouées', value: stats.games },
    { label: 'Victoires', value: stats.wins },
    { label: 'Taux de victoire', value: `${rate}%` },
    { label: 'Points / partie', value: avg },
    { label: 'Meilleur score', value: stats.bestScore ?? '—' },
    { label: 'Points cumulés', value: stats.totalPoints },
  ];
  return (
    <div className="panel">
      <div className="panelhead"><h3>Mes statistiques</h3></div>
      {stats.games === 0 && (
        <p className="muted">
          Aucune partie en ligne enregistrée. Les stats ne comptent que les parties en ligne (au moins 2 comptes).
        </p>
      )}
      <div className="statgrid">
        {cards.map((c) => (
          <div key={c.label} className="statcell">
            <span className="statval">{c.value}</span>
            <span className="statlabel">{c.label}</span>
          </div>
        ))}
      </div>
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
        <label>Ordre des couleurs, de gauche à droite</label>
        <div className="suitorder">
          {pref.suitOrder.map((s, i) => (
            <div key={s} className={`suitchip ${SUIT_RED[s] ? 'red' : 'black'}`}>
              <button className="ghost tiny" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Déplacer à gauche"><Icon name="arrowLeft" size={14} /></button>
              <span className="suitsym">{SUIT_SYMBOL[s]}</span>
              <button className="ghost tiny" disabled={i === pref.suitOrder.length - 1} onClick={() => move(i, 1)} aria-label="Déplacer à droite"><Icon name="arrowRight" size={14} /></button>
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

// --- Suppression du compte -------------------------------------------------

/**
 * Suppression définitive. Deux garde-fous : il faut déplier la zone, puis
 * retaper son mot de passe — que le serveur revérifie. Un simple clic ne doit
 * pas pouvoir effacer un compte.
 */
function DeletePanel({ auth }: { auth: Auth }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.deleteAccount(password);
      // Succès : le compte a disparu, `auth` renvoie l'écran de connexion.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.');
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="danger-zone">
        <p>
          Supprimer définitivement ton compte : pseudo, photo, amis, statistiques, parties
          sauvegardées. C'est irréversible.
        </p>
        {!open ? (
          <button className="danger" onClick={() => setOpen(true)}>
            <Icon name="trash" size={16} />Supprimer mon compte
          </button>
        ) : (
          <div className="field">
            <label>Confirme avec ton mot de passe</label>
            <div className="inlinerow">
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="danger" disabled={!password || busy} onClick={submit}>
                Supprimer
              </button>
              <button className="ghost" disabled={busy} onClick={() => { setOpen(false); setPassword(''); setError(null); }}>
                Annuler
              </button>
            </div>
          </div>
        )}
        {error && <p className="errline">{error}</p>}
      </div>
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
