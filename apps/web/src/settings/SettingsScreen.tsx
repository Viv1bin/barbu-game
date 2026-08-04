import { useState } from 'react';
import { AVATARS } from '../auth/avatars.js';
import { ApiError, type Auth } from '../auth/useAuth.js';

/** Écran « Mon compte » : avatar, pseudo, déconnexion. */
export function SettingsScreen({ onBack, auth }: { onBack: () => void; auth: Auth }) {
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
          <h1>Mon compte <span className="mode">pseudo, avatar, session</span></h1>
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

          {error && <p className="errline">⚠️ {error}</p>}
          {notice && <p className="okline">✓ {notice}</p>}
        </div>

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
