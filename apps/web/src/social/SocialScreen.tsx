import { useMemo, useState } from 'react';
import type { Account, FriendInfo, FriendRequestInfo, PlayerStats } from '@barbu/engine';
import { ApiError, useSocial } from './useSocial.js';

type Tab = 'friends' | 'ranking' | 'stats';

/** Écran « Amis & stats » : gestion des amis, classement, statistiques perso. */
export function SocialScreen({ onBack, token, me }: { onBack: () => void; token: string | null; me: Account }) {
  const social = useSocial(token);
  const [tab, setTab] = useState<Tab>('friends');

  return (
    <div className="app">
      <div className="topbar">
        <button className="ghost" onClick={onBack}>← Menu</button>
        <h1>Amis &amp; stats</h1>
      </div>

      <div className="tabs socialtabs">
        <button className={tab === 'friends' ? 'on' : 'ghost'} onClick={() => setTab('friends')}>
          Amis{social.snapshot.requests.some((r) => r.direction === 'incoming') ? ' ●' : ''}
        </button>
        <button className={tab === 'ranking' ? 'on' : 'ghost'} onClick={() => setTab('ranking')}>Classement</button>
        <button className={tab === 'stats' ? 'on' : 'ghost'} onClick={() => setTab('stats')}>Mes stats</button>
      </div>

      {social.error && <p className="errline">⚠️ {social.error}</p>}
      {social.loading ? (
        <p className="muted">Chargement…</p>
      ) : tab === 'friends' ? (
        <FriendsTab social={social} />
      ) : tab === 'ranking' ? (
        <RankingTab friends={social.snapshot.friends} me={me} myStats={social.stats} />
      ) : (
        <StatsTab stats={social.stats} />
      )}
    </div>
  );
}

// --- Onglet Amis -----------------------------------------------------------

function FriendsTab({ social }: { social: ReturnType<typeof useSocial> }) {
  const [pseudo, setPseudo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const incoming = social.snapshot.requests.filter((r) => r.direction === 'incoming');
  const outgoing = social.snapshot.requests.filter((r) => r.direction === 'outgoing');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = pseudo.trim();
    if (!p) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const status = await social.addFriend(p);
      setNotice(status === 'accepted' ? `${p} est maintenant ton ami !` : `Demande envoyée à ${p}.`);
      setPseudo('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sociallist">
      <form className="panel addfriend" onSubmit={submit}>
        <label>Ajouter un ami</label>
        <div className="inlinerow">
          <input
            value={pseudo}
            placeholder="Pseudo du joueur"
            maxLength={18}
            autoCapitalize="none"
            onChange={(e) => setPseudo(e.target.value)}
          />
          <button disabled={busy || !pseudo.trim()}>Envoyer</button>
        </div>
        {error && <p className="errline">⚠️ {error}</p>}
        {notice && <p className="okline">✓ {notice}</p>}
      </form>

      {incoming.length > 0 && (
        <div className="panel">
          <div className="panelhead"><h3>Demandes reçues</h3></div>
          {incoming.map((r) => (
            <RequestRow key={r.id} req={r}>
              <button className="tiny" onClick={() => void social.respond(r.id, true)}>Accepter</button>
              <button className="ghost tiny" onClick={() => void social.respond(r.id, false)}>Refuser</button>
            </RequestRow>
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="panel">
          <div className="panelhead"><h3>Demandes envoyées</h3></div>
          {outgoing.map((r) => (
            <RequestRow key={r.id} req={r}>
              <span className="muted">en attente…</span>
              <button className="ghost tiny" onClick={() => void social.cancel(r.id)}>Annuler</button>
            </RequestRow>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="panelhead"><h3>Mes amis ({social.snapshot.friends.length})</h3></div>
        {social.snapshot.friends.length === 0 ? (
          <p className="muted">Aucun ami pour l'instant. Ajoute quelqu'un par son pseudo ci-dessus.</p>
        ) : (
          social.snapshot.friends.map((f) => (
            <FriendRow key={f.id} friend={f} onRemove={() => void social.remove(f.id)} />
          ))
        )}
      </div>
    </div>
  );
}

function RequestRow({ req, children }: { req: FriendRequestInfo; children: React.ReactNode }) {
  return (
    <div className="friendrow">
      <span className="avatar">{req.avatar}</span>
      <span className="frname">{req.pseudo}</span>
      <span className="fractions">{children}</span>
    </div>
  );
}

function FriendRow({ friend, onRemove }: { friend: FriendInfo; onRemove: () => void }) {
  return (
    <div className="friendrow">
      <span className={`dot ${friend.online ? 'online' : ''}`} title={friend.online ? 'En ligne' : 'Hors ligne'} />
      <span className="avatar">{friend.avatar}</span>
      <span className="frname">{friend.pseudo}</span>
      <span className="frstat muted">{friend.stats.wins}V · {friend.stats.games}pj</span>
      <span className="fractions">
        <button className="ghost tiny" onClick={onRemove} title="Retirer cet ami">Retirer</button>
      </span>
    </div>
  );
}

// --- Onglet Classement -----------------------------------------------------

function RankingTab({ friends, me, myStats }: { friends: FriendInfo[]; me: Account; myStats: PlayerStats }) {
  const rows = useMemo(() => {
    const all = [
      { id: me.id, pseudo: me.pseudo, avatar: me.avatar, stats: myStats, isMe: true },
      ...friends.map((f) => ({ id: f.id, pseudo: f.pseudo, avatar: f.avatar, stats: f.stats, isMe: false })),
    ];
    // Classement : plus de victoires d'abord, puis meilleur (plus bas) cumul de points.
    return all.sort((a, b) => b.stats.wins - a.stats.wins || a.stats.totalPoints - b.stats.totalPoints);
  }, [friends, me, myStats]);

  if (friends.length === 0) {
    return <p className="muted">Ajoute des amis pour voir un classement entre vous.</p>;
  }

  return (
    <div className="panel rankboard">
      <div className="rankrow rankhead">
        <span>#</span><span>Joueur</span><span>V</span><span>Pj</span><span>%</span>
      </div>
      {rows.map((r, i) => {
        const rate = r.stats.games ? Math.round((r.stats.wins / r.stats.games) * 100) : 0;
        return (
          <div key={r.id} className={`rankrow ${r.isMe ? 'me' : ''}`}>
            <span className="rank">{i + 1}</span>
            <span className="rankwho"><span className="avatar">{r.avatar}</span>{r.pseudo}{r.isMe ? ' (toi)' : ''}</span>
            <span>{r.stats.wins}</span>
            <span>{r.stats.games}</span>
            <span>{rate}%</span>
          </div>
        );
      })}
    </div>
  );
}

// --- Onglet Mes stats ------------------------------------------------------

function StatsTab({ stats }: { stats: PlayerStats }) {
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
    <>
      {stats.games === 0 && <p className="muted">Aucune partie en ligne enregistrée. Les stats ne comptent que les parties en ligne (au moins 2 comptes).</p>}
      <div className="statgrid">
        {cards.map((c) => (
          <div key={c.label} className="statcell">
            <span className="statval">{c.value}</span>
            <span className="statlabel">{c.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}
