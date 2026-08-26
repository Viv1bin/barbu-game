import { useMemo, useState } from 'react';
import type { Account, FriendInfo, FriendRequestInfo, OnlineMatch, PlayerStats } from '@barbu/engine';
import { ApiError, useSocial } from './useSocial.js';
import { Avatar } from '../ui/Avatar.js';
import { Icon } from '../ui/Icon.js';
import { useHubTab } from '../ui/useHubTab.js';

type Tab = 'friends' | 'ranking' | 'matches';

/**
 * Onglet « Amis » : amis, classement et parties jouées ensemble. L'en-tête et
 * la barre d'onglets sont dans un bloc de hauteur fixe, et le contenu dans une
 * zone à hauteur minimale : la barre reste au même endroit quel que soit l'onglet.
 */
export function SocialScreen({
  token,
  me,
  onJoinRoom,
}: {
  token: string | null;
  me: Account;
  /** Rejoindre une salle en ligne depuis l'historique (partie encore en cours). */
  onJoinRoom: (code: string) => void;
}) {
  const social = useSocial(token);
  const [tab, setTab] = useState<Tab>('friends');
  const pick = useHubTab(setTab);

  return (
    <div className="hub">
      <div className="hubhead">
        <h2>Amis</h2>
      </div>

      <div className="tabs socialtabs">
        <button className={tab === 'friends' ? 'on' : 'ghost'} onClick={() => pick('friends')}>
          Amis{social.snapshot.requests.some((r) => r.direction === 'incoming') && <span className="badge" />}
        </button>
        <button className={tab === 'ranking' ? 'on' : 'ghost'} onClick={() => pick('ranking')}>Classement</button>
        <button className={tab === 'matches' ? 'on' : 'ghost'} onClick={() => pick('matches')}>Parties</button>
      </div>

      <div className="tabpane">
        {social.error && <p className="errline">{social.error}</p>}
        {social.loading ? (
          <p className="muted">Chargement…</p>
        ) : tab === 'friends' ? (
          <FriendsTab social={social} />
        ) : tab === 'ranking' ? (
          <RankingTab friends={social.snapshot.friends} me={me} myStats={social.stats} />
        ) : (
          <MatchesTab matches={social.matches} me={me} onJoinRoom={onJoinRoom} />
        )}
      </div>
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
        {error && <p className="errline">{error}</p>}
        {notice && <p className="okline">{notice}</p>}
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
      <Avatar name={req.avatar} />
      <span className="frname">{req.pseudo}</span>
      <span className="fractions">{children}</span>
    </div>
  );
}

function FriendRow({ friend, onRemove }: { friend: FriendInfo; onRemove: () => void }) {
  return (
    <div className="friendrow">
      <Avatar name={friend.avatar} />
      <span className="frname">{friend.pseudo}</span>
      <span className={`frstat ${friend.online ? 'on' : ''}`}>
        <span className={`dot ${friend.online ? 'online' : ''}`} />
        {friend.online ? 'en ligne' : 'hors ligne'}
      </span>
      <span className="fractions">
        <button className="ghost tiny" onClick={onRemove} title="Retirer cet ami">Retirer</button>
      </span>
    </div>
  );
}

// --- Onglet Parties --------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Historique des parties en ligne : celles encore en cours en premier (on peut
 * y retourner par le code de salle), puis les parties terminées avec les scores.
 * Les parties solo ne sont pas ici : elles vivent dans Profil → Parties.
 */
function MatchesTab({
  matches,
  me,
  onJoinRoom,
}: {
  matches: OnlineMatch[];
  me: Account;
  onJoinRoom: (code: string) => void;
}) {
  if (matches.length === 0) {
    return (
      <p className="muted">
        Aucune partie en ligne pour l'instant. Elles apparaîtront ici dès que tu joueras avec au
        moins un autre compte.
      </p>
    );
  }

  const live = matches.filter((m) => !m.endedAt);
  const done = matches.filter((m) => m.endedAt);

  return (
    <div className="sociallist">
      {live.length > 0 && (
        <div className="panel">
          <div className="panelhead"><h3>En cours</h3></div>
          {live.map((m) => (
            <MatchRow key={m.id} match={m} me={me}>
              <button className="tiny" onClick={() => onJoinRoom(m.code)}>
                <Icon name="play" size={14} />Reprendre
              </button>
            </MatchRow>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="panelhead"><h3>Terminées ({done.length})</h3></div>
        {done.length === 0 ? (
          <p className="muted">Aucune partie terminée pour l'instant.</p>
        ) : (
          done.map((m) => <MatchRow key={m.id} match={m} me={me} />)
        )}
      </div>
    </div>
  );
}

function MatchRow({ match, me, children }: { match: OnlineMatch; me: Account; children?: React.ReactNode }) {
  const when = DATE_FMT.format(new Date(match.endedAt ?? match.startedAt));
  // Partie finie : le premier de la liste (score le plus bas) l'emporte.
  const best = match.endedAt ? match.players[0]?.score ?? null : null;

  return (
    <div className="matchrow">
      <div className="mr-head">
        <span className="mr-when">{when}</span>
        {match.endedAt ? <span className="mr-code">{match.code}</span> : <span className="mr-live">en cours</span>}
        {children}
      </div>
      <div className="mr-players">
        {match.players.map((p) => (
          <span
            key={p.id}
            className={`mr-p ${p.id === me.id ? 'me' : ''} ${best !== null && p.score === best ? 'win' : ''}`}
          >
            <Avatar name={p.avatar} size="sm" />
            {p.pseudo}
            {p.score !== null && <b>{p.score}</b>}
          </span>
        ))}
      </div>
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
            <span className="rankwho"><Avatar name={r.avatar} size="sm" />{r.pseudo}{r.isMe ? ' (toi)' : ''}</span>
            <span>{r.stats.wins}</span>
            <span>{r.stats.games}</span>
            <span>{rate}%</span>
          </div>
        );
      })}
    </div>
  );
}
