import { useState } from 'react';
import { computeStats } from './stats.js';
import { AVATARS, type Profile } from './store.js';
import type { Profiles } from './useProfiles.js';
import { ProfileCard } from './ProfileCard.js';

const SEAT_LABEL = ['Siège 1', 'Siège 2', 'Siège 3', 'Siège 4'];

/** Sélection des 4 joueurs : profils enregistrés ou création à la volée. */
export function ProfileSetup({ profiles, onStart }: { profiles: Profiles; onStart: (ids: string[]) => void }) {
  const { store } = profiles;
  const [seats, setSeats] = useState<(string | null)[]>([null, null, null, null]);
  const [openSeat, setOpenSeat] = useState<number | null>(null);
  const [viewing, setViewing] = useState<Profile | null>(null);

  const taken = seats.filter((s): s is string => s !== null);
  const ready = taken.length === 4;

  const assign = (seat: number, id: string | null) => {
    setSeats((arr) => arr.map((v, i) => (i === seat ? id : v)));
    setOpenSeat(null);
  };

  return (
    <main>
      <div className="picker setup-wide">
        <p>Qui joue ? Choisis un profil enregistré ou crée-en un nouveau.</p>

        <div className="seatgrid">
          {SEAT_LABEL.map((label, i) => {
            const id = seats[i];
            const p = id ? store.profiles.find((x) => x.id === id) : undefined;
            return (
              <div key={i} className={`seatslot ${p ? 'filled' : ''}`}>
                <div className="slabel">{label}</div>
                {p ? (
                  <>
                    <div className="avatar big">{p.avatar}</div>
                    <div className="pfname">{p.name}</div>
                    <div className="muted">
                      {(() => {
                        const s = computeStats(store, p.id);
                        return `${s.levelLabel} · ${s.level.toFixed(0)}/100`;
                      })()}
                    </div>
                    <div className="btnrow tight">
                      <button className="ghost tiny" onClick={() => setViewing(p)}>Stats</button>
                      <button className="ghost tiny" onClick={() => assign(i, null)}>Changer</button>
                    </div>
                  </>
                ) : (
                  <button onClick={() => setOpenSeat(i)}>Choisir</button>
                )}
              </div>
            );
          })}
        </div>

        <p className="muted">L'ordre des sièges doit suivre le sens du jeu autour de la table.</p>
        <button disabled={!ready} onClick={() => ready && onStart(taken)}>Commencer la partie</button>
      </div>

      {openSeat !== null && (
        <SeatPicker
          profiles={profiles}
          excluded={taken}
          onPick={(id) => assign(openSeat, id)}
          onClose={() => setOpenSeat(null)}
          onView={setViewing}
        />
      )}

      {viewing && (
        <ProfileCard
          store={store}
          profile={viewing}
          onClose={() => setViewing(null)}
          onDelete={(id) => {
            profiles.remove(id);
            setSeats((arr) => arr.map((v) => (v === id ? null : v)));
            setViewing(null);
          }}
        />
      )}
    </main>
  );
}

function SeatPicker({
  profiles,
  excluded,
  onPick,
  onClose,
  onView,
}: {
  profiles: Profiles;
  excluded: string[];
  onPick: (id: string) => void;
  onClose: () => void;
  onView: (p: Profile) => void;
}) {
  const [creating, setCreating] = useState(profiles.store.profiles.length === 0);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]!);

  const available = profiles.store.profiles.filter((p) => !excluded.includes(p.id));

  const submit = () => {
    if (!name.trim()) return;
    const p = profiles.create(name, avatar);
    onPick(p.id);
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modhead">
          <h3>{creating ? 'Nouveau joueur' : 'Choisir un joueur'}</h3>
          <button className="ghost close" onClick={onClose}>✕</button>
        </div>

        {creating ? (
          <div className="newprofile">
            <input
              autoFocus
              value={name}
              placeholder="Prénom / pseudo"
              maxLength={18}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <div className="avatars">
              {AVATARS.map((a) => (
                <button key={a} className={`avatarpick ${a === avatar ? 'on' : ''}`} onClick={() => setAvatar(a)}>{a}</button>
              ))}
            </div>
            <div className="btnrow">
              <button disabled={!name.trim()} onClick={submit}>Créer et asseoir</button>
              {profiles.store.profiles.length > 0 && (
                <button className="ghost" onClick={() => setCreating(false)}>Retour à la liste</button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="plist">
              {available.length === 0 && <p className="muted">Tous les profils sont déjà assis.</p>}
              {available.map((p) => {
                const s = computeStats(profiles.store, p.id);
                return (
                  <div key={p.id} className="prow-pick">
                    <button className="pickbtn" onClick={() => onPick(p.id)}>
                      <span className="avatar">{p.avatar}</span>
                      <span className="pickinfo">
                        <span className="pfname">{p.name}</span>
                        <span className="muted">{s.levelLabel} · {s.level.toFixed(0)}/100 · {s.games} partie(s)</span>
                      </span>
                    </button>
                    <button className="ghost tiny" onClick={() => onView(p)}>Stats</button>
                  </div>
                );
              })}
            </div>
            <button className="ghost" onClick={() => setCreating(true)}>＋ Nouveau joueur</button>
          </>
        )}
      </div>
    </div>
  );
}
