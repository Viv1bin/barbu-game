import { useMemo, useRef, useState } from 'react';
import { rankingOf, stateFromRecord } from '../arbiter/fromRecord.js';
import { ScoreTable } from '../arbiter/Tracking.js';
import { ProfileCard } from '../profiles/ProfileCard.js';
import { computeStats } from '../profiles/stats.js';
import { AVATARS, parseBackup, toBackup, type MatchRecord, type Profile } from '../profiles/store.js';
import { useProfiles, type Profiles } from '../profiles/useProfiles.js';

type Tab = 'profils' | 'historique' | 'donnees';

const TABS: { id: Tab; label: string }[] = [
  { id: 'profils', label: '👤 Profils' },
  { id: 'historique', label: '📜 Historique' },
  { id: 'donnees', label: '💾 Données' },
];

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const profiles = useProfiles();
  const [tab, setTab] = useState<Tab>('profils');

  return (
    <div className="app">
      <header>
        <div className="topbar">
          <button className="ghost" onClick={onBack}>← Menu</button>
          <h1>Réglages <span className="mode">profils, historique et données</span></h1>
        </div>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? '' : 'ghost'} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
      </header>

      <main className="settings-main">
        {tab === 'profils' && <ProfilesTab profiles={profiles} />}
        {tab === 'historique' && <HistoryTab profiles={profiles} />}
        {tab === 'donnees' && <DataTab profiles={profiles} />}
      </main>
    </div>
  );
}

// ================= Profils =================

function ProfilesTab({ profiles }: { profiles: Profiles }) {
  const { store } = profiles;
  const [editing, setEditing] = useState<Profile | null>(null);
  const [viewing, setViewing] = useState<Profile | null>(null);
  const [creating, setCreating] = useState(false);

  const sorted = useMemo(
    () => [...store.profiles].sort((a, b) => computeStats(store, b.id).level - computeStats(store, a.id).level),
    [store],
  );

  return (
    <div className="panel">
      <div className="panelhead">
        <h3>{store.profiles.length} profil{store.profiles.length > 1 ? 's' : ''}</h3>
        <button onClick={() => setCreating(true)}>＋ Nouveau</button>
      </div>

      {store.profiles.length === 0 && <p className="muted">Aucun profil. Crée-en un ici ou au lancement d'une partie arbitrée.</p>}

      <div className="plist">
        {sorted.map((p) => {
          const s = computeStats(store, p.id);
          return (
            <div key={p.id} className="prow-manage">
              <span className="avatar">{p.avatar}</span>
              <span className="pickinfo">
                <span className="pfname">{p.name}</span>
                <span className="muted">
                  {s.levelLabel} · {s.level.toFixed(0)}/100 · {s.games} partie(s) · {s.wins} victoire(s)
                </span>
              </span>
              <button className="ghost tiny" onClick={() => setViewing(p)}>Stats</button>
              <button className="ghost tiny" onClick={() => setEditing(p)}>Modifier</button>
            </div>
          );
        })}
      </div>

      {creating && (
        <EditProfile
          title="Nouveau joueur"
          initialName=""
          initialAvatar={AVATARS[0]!}
          onSave={(name, avatar) => {
            profiles.create(name, avatar);
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {editing && (
        <EditProfile
          title="Modifier le profil"
          initialName={editing.name}
          initialAvatar={editing.avatar}
          onSave={(name, avatar) => {
            profiles.rename(editing.id, name, avatar);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
          onDelete={() => {
            profiles.remove(editing.id);
            setEditing(null);
          }}
        />
      )}

      {viewing && (
        <ProfileCard
          store={store}
          profile={viewing}
          onClose={() => setViewing(null)}
          onDelete={(id) => {
            profiles.remove(id);
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}

function EditProfile({
  title,
  initialName,
  initialAvatar,
  onSave,
  onClose,
  onDelete,
}: {
  title: string;
  initialName: string;
  initialAvatar: string;
  onSave: (name: string, avatar: string) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modhead">
          <h3>{title}</h3>
          <button className="ghost close" onClick={onClose}>✕</button>
        </div>
        <div className="newprofile">
          <input autoFocus value={name} maxLength={18} placeholder="Prénom / pseudo" onChange={(e) => setName(e.target.value)} />
          <div className="avatars">
            {AVATARS.map((a) => (
              <button key={a} className={`avatarpick ${a === avatar ? 'on' : ''}`} onClick={() => setAvatar(a)}>{a}</button>
            ))}
          </div>
          <button disabled={!name.trim()} onClick={() => onSave(name, avatar)}>Enregistrer</button>
        </div>

        {onDelete &&
          (confirmDel ? (
            <div className="danger-zone">
              <p className="muted">
                Supprimer ce profil ? Ses statistiques disparaissent. Les parties sont conservées : il apparaîtra comme
                « Inconnu » dans les stats des autres joueurs.
              </p>
              <div className="btnrow">
                <button className="danger-solid" onClick={onDelete}>Oui, supprimer</button>
                <button className="ghost" onClick={() => setConfirmDel(false)}>Annuler</button>
              </div>
            </div>
          ) : (
            <button className="ghost danger" onClick={() => setConfirmDel(true)}>Supprimer ce profil</button>
          ))}
      </div>
    </div>
  );
}

// ================= Historique =================

function HistoryTab({ profiles }: { profiles: Profiles }) {
  const { store } = profiles;
  const [open, setOpen] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  // Plus récente en premier.
  const matches = useMemo(() => [...store.matches].reverse(), [store.matches]);

  const downloadPdf = async (m: MatchRecord) => {
    setPdfBusy(m.id);
    try {
      const { exportScoresPdf } = await import('../arbiter/pdf.js');
      exportScoresPdf(stateFromRecord(store, m));
    } finally {
      setPdfBusy(null);
    }
  };

  if (matches.length === 0) {
    return (
      <div className="panel">
        <p className="muted">Aucune partie enregistrée. Termine une partie en mode Arbitre pour la voir ici.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panelhead">
        <h3>{matches.length} partie{matches.length > 1 ? 's' : ''}</h3>
      </div>

      <div className="hlist">
        {matches.map((m) => {
          const state = stateFromRecord(store, m);
          const ranking = rankingOf(state);
          const isOpen = open === m.id;
          return (
            <div key={m.id} className={`hcard ${isOpen ? 'open' : ''}`}>
              <button className="hhead" onClick={() => setOpen(isOpen ? null : m.id)}>
                <span className="hdate">
                  {new Date(m.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
                <span className="hwin">🏆 {ranking[0]!.avatar} {ranking[0]!.name}</span>
                <span className="hplayers">{state.avatars.join(' ')}</span>
                <span className="muted">{m.history.length} manches</span>
                <span className="hchev">{isOpen ? '▾' : '▸'}</span>
              </button>

              {isOpen && (
                <div className="hbody">
                  <ol className="ranking">
                    {ranking.map((r, i) => (
                      <li key={r.name} className={i === 0 ? 'winner' : ''}>
                        <span>{['🥇', '🥈', '🥉', '4e'][i]} {r.avatar} {r.name}</span>
                        <span>{r.score} pts</span>
                      </li>
                    ))}
                  </ol>
                  <ScoreTable state={state} />
                  <div className="btnrow">
                    <button disabled={pdfBusy === m.id} onClick={() => downloadPdf(m)}>
                      {pdfBusy === m.id ? 'Génération…' : '⬇ PDF'}
                    </button>
                    <button className="ghost danger" onClick={() => profiles.removeMatch(m.id)}>
                      Supprimer cette partie
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ================= Données =================

function DataTab({ profiles }: { profiles: Profiles }) {
  const { store } = profiles;
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<'history' | 'all' | null>(null);
  const [pending, setPending] = useState<{ text: string; profiles: number; matches: number } | null>(null);

  const size = useMemo(() => new Blob([JSON.stringify(store)]).size, [store]);

  const doExport = () => {
    const blob = new Blob([JSON.stringify(toBackup(store), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `barbu-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg({ kind: 'ok', text: 'Sauvegarde téléchargée.' });
  };

  const pickFile = async (file: File) => {
    const text = await file.text();
    try {
      const incoming = parseBackup(text);
      setPending({ text, profiles: incoming.profiles.length, matches: incoming.matches.length });
      setMsg(null);
    } catch (e) {
      setPending(null);
      setMsg({ kind: 'err', text: (e as Error).message });
    }
  };

  const apply = (mode: 'merge' | 'replace') => {
    if (!pending) return;
    const incoming = parseBackup(pending.text);
    if (mode === 'merge') profiles.merge(incoming);
    else profiles.replace(incoming);
    setPending(null);
    setMsg({ kind: 'ok', text: mode === 'merge' ? 'Sauvegarde fusionnée.' : 'Données remplacées.' });
  };

  return (
    <div className="panel">
      <div className="panelhead">
        <h3>Données locales</h3>
      </div>
      <p className="muted">
        Tout est stocké dans ce navigateur ({store.profiles.length} profil(s), {store.matches.length} partie(s),{' '}
        {(size / 1024).toFixed(1)} ko). Rien n'est envoyé sur un serveur : l'enregistrement est immédiat à chaque
        changement, donc fermer l'onglet ou couper le serveur ne perd rien.
      </p>

      {msg && <p className={msg.kind === 'ok' ? 'okmsg' : 'errmsg'}>{msg.text}</p>}

      <div className="datarow">
        <div>
          <div className="dtitle">Exporter</div>
          <div className="muted">Un fichier JSON avec tous les profils et toutes les parties.</div>
        </div>
        <button onClick={doExport}>⬇ Exporter</button>
      </div>

      <div className="datarow">
        <div>
          <div className="dtitle">Importer</div>
          <div className="muted">Restaurer une sauvegarde, ou récupérer les données depuis un autre navigateur.</div>
        </div>
        <button className="ghost" onClick={() => fileRef.current?.click()}>⬆ Choisir un fichier</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {pending && (
        <div className="danger-zone">
          <p>
            Sauvegarde lue : <b>{pending.profiles} profil(s)</b> et <b>{pending.matches} partie(s)</b>.
          </p>
          <div className="btnrow">
            <button onClick={() => apply('merge')}>Fusionner avec l'existant</button>
            <button className="danger-solid" onClick={() => apply('replace')}>Tout remplacer</button>
            <button className="ghost" onClick={() => setPending(null)}>Annuler</button>
          </div>
          <p className="muted">
            « Fusionner » ajoute ce qui manque et garde tes données actuelles. « Tout remplacer » efface définitivement
            les {store.profiles.length} profil(s) et {store.matches.length} partie(s) de ce navigateur.
          </p>
        </div>
      )}

      <div className="panelhead">
        <h3 className="danger-title">Réinitialiser</h3>
      </div>

      <div className="datarow">
        <div>
          <div className="dtitle">Effacer l'historique</div>
          <div className="muted">Supprime les {store.matches.length} partie(s). Les profils restent, leurs stats repartent à zéro.</div>
        </div>
        <button className="ghost danger" onClick={() => setConfirm('history')}>Effacer</button>
      </div>

      <div className="datarow">
        <div>
          <div className="dtitle">Tout réinitialiser</div>
          <div className="muted">Supprime les profils et les parties. Retour à une installation neuve.</div>
        </div>
        <button className="ghost danger" onClick={() => setConfirm('all')}>Tout effacer</button>
      </div>

      {confirm && (
        <div className="modal-back" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modhead">
              <h3>Confirmer</h3>
              <button className="ghost close" onClick={() => setConfirm(null)}>✕</button>
            </div>
            <p>
              {confirm === 'history'
                ? `Effacer les ${store.matches.length} partie(s) enregistrée(s) ? Les statistiques de tous les profils repartent de zéro.`
                : `Effacer les ${store.profiles.length} profil(s) et les ${store.matches.length} partie(s) ?`}
            </p>
            <p className="muted">Cette action est définitive. Exporte une sauvegarde d'abord si tu veux pouvoir revenir en arrière.</p>
            <div className="btnrow">
              <button
                className="danger-solid"
                onClick={() => {
                  if (confirm === 'history') profiles.clearHistory();
                  else profiles.resetAll();
                  setConfirm(null);
                  setMsg({ kind: 'ok', text: confirm === 'history' ? 'Historique effacé.' : 'Données réinitialisées.' });
                }}
              >
                Oui, effacer
              </button>
              <button className="ghost" onClick={() => setConfirm(null)}>Annuler</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
