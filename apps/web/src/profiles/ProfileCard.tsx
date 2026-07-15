import { CONTRACT_LABEL } from '../format.js';
import { computeStats } from './stats.js';
import type { Profile, Store } from './store.js';

function num(x: number, digits = 0): string {
  return x.toFixed(digits);
}

function signed(x: number): string {
  return `${x > 0 ? '+' : ''}${x.toFixed(0)}`;
}

/** Fiche détaillée d'un joueur : niveau global + statistiques. */
export function ProfileCard({
  store,
  profile,
  onClose,
  onDelete,
}: {
  store: Store;
  profile: Profile;
  onClose: () => void;
  onDelete?: (id: string) => void;
}) {
  const s = computeStats(store, profile.id);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card-profile" onClick={(e) => e.stopPropagation()}>
        <div className="pfhead">
          <div className="avatar big">{profile.avatar}</div>
          <div>
            <div className="pfname">{profile.name}</div>
            <div className="muted">{s.games} partie{s.games > 1 ? 's' : ''} jouée{s.games > 1 ? 's' : ''}</div>
          </div>
          <button className="ghost close" onClick={onClose}>✕</button>
        </div>

        <div className="levelbox">
          <div className="lvlnum">{num(s.level)}<span>/100</span></div>
          <div className="lvlmeta">
            <div className="lvllabel">{s.levelLabel}</div>
            <div className="lvlbar"><div className="lvlfill" style={{ width: `${s.level}%` }} /></div>
            {!s.reliable && <div className="muted">Note indicative — moins de 3 parties.</div>}
          </div>
        </div>

        {s.games === 0 ? (
          <p className="muted">Aucune partie enregistrée. Les statistiques apparaîtront après la première partie terminée.</p>
        ) : (
          <>
            <div className="statgrid">
              <Stat label="Victoires" value={`${s.wins}/${s.games}`} sub={`${num(s.winRate * 100)} %`} />
              <Stat label="Podiums (top 2)" value={`${s.podiums}/${s.games}`} />
              <Stat label="Score moyen" value={num(s.avgScore)} sub="bas = bon" />
              <Stat label="Meilleur score" value={s.bestScore === null ? '—' : num(s.bestScore)} />
              <Stat label="Pire score" value={s.worstScore === null ? '—' : num(s.worstScore)} />
              <Stat label="Régularité (écart-type)" value={num(s.deviation)} sub="bas = constant" />
              <Stat label="Écart moyen / table" value={signed(s.margin)} sub="positif = devant" />
              <Stat
                label="Contres réussis"
                value={s.contresPlayed ? `${s.contresWon}/${s.contresPlayed}` : '—'}
                sub={s.contresPlayed ? `${num(s.contreRate * 100)} %` : undefined}
              />
            </div>

            <div className="statrow">
              <div className="statcard good">
                <div className="sclabel">Meilleur contrat</div>
                <div className="scval">{s.bestContract ? CONTRACT_LABEL[s.bestContract.contract] : '—'}</div>
                {s.bestContract && <div className="muted">{num(s.bestContract.avg, 1)} pts / manche · {s.bestContract.played} jouée(s)</div>}
              </div>
              <div className="statcard bad">
                <div className="sclabel">Contrat faible</div>
                <div className="scval">{s.worstContract ? CONTRACT_LABEL[s.worstContract.contract] : '—'}</div>
                {s.worstContract && <div className="muted">{num(s.worstContract.avg, 1)} pts / manche · {s.worstContract.played} jouée(s)</div>}
              </div>
              <div className="statcard bad">
                <div className="sclabel">Pire adversaire</div>
                <div className="scval">{s.worstRival ? `${s.worstRival.avatar} ${s.worstRival.name}` : '—'}</div>
                {s.worstRival && (
                  <div className="muted">
                    devant {s.worstRival.lost}/{s.worstRival.games} fois · écart {signed(-s.worstRival.margin)}
                  </div>
                )}
              </div>
            </div>

            <details className="detail">
              <summary>Détail par contrat</summary>
              <table className="dtable">
                <thead>
                  <tr><th>Contrat</th><th>Manches</th><th>Pts / manche</th></tr>
                </thead>
                <tbody>
                  {s.contracts.map((c) => (
                    <tr key={c.contract}>
                      <td>{CONTRACT_LABEL[c.contract]}</td>
                      <td>{c.played}</td>
                      <td>{c.played ? num(c.avg, 1) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>

            {s.rivals.length > 0 && (
              <details className="detail">
                <summary>Face-à-face</summary>
                <table className="dtable">
                  <thead>
                    <tr><th>Adversaire</th><th>Parties</th><th>Devant moi</th><th>Écart moyen</th></tr>
                  </thead>
                  <tbody>
                    {s.rivals.map((r) => (
                      <tr key={r.id}>
                        <td>{r.avatar} {r.name}</td>
                        <td>{r.games}</td>
                        <td>{r.lost}</td>
                        <td className={r.margin < 0 ? 'neg' : 'pos'}>{signed(-r.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </>
        )}

        {onDelete && (
          <button className="ghost danger" onClick={() => onDelete(profile.id)}>
            Supprimer ce profil
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stlabel">{label}</div>
      <div className="stval">{value}</div>
      {sub && <div className="stsub">{sub}</div>}
    </div>
  );
}
