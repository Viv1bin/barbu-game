import { useState } from 'react';
import { DEFAULT_AVATAR, MIN_PASSWORD_LENGTH } from '@barbu/engine';
import { ApiError, type Auth } from './useAuth.js';

type Mode = 'login' | 'register';

/** Écran d'entrée : connexion ou inscription (pseudo + mot de passe). */
export function AuthScreen({ auth }: { auth: Auth }) {
  const [mode, setMode] = useState<Mode>('login');
  const [pseudo, setPseudo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Le minimum ne s'applique qu'aux nouveaux mots de passe : les comptes créés
  // avant le durcissement doivent pouvoir continuer à se connecter.
  const minLength = mode === 'register' ? MIN_PASSWORD_LENGTH : 1;
  const ready = pseudo.trim().length >= 2 && password.length >= minLength && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') await auth.register(pseudo, password, DEFAULT_AVATAR);
      else await auth.login(pseudo, password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  };

  const swap = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  return (
    <div className="menu">
      <div className="hero">
        <h1>Barbu</h1>
        <p>{mode === 'login' ? 'Connecte-toi pour jouer.' : 'Crée ton compte pour jouer.'}</p>
      </div>

      <div className="picker setup-wide">
        <div className="tabs">
          <button className={mode === 'login' ? '' : 'ghost'} onClick={() => swap('login')}>Connexion</button>
          <button className={mode === 'register' ? '' : 'ghost'} onClick={() => swap('register')}>Inscription</button>
        </div>

        <div className="newprofile">
          <input
            autoFocus
            value={pseudo}
            placeholder="Pseudo"
            maxLength={18}
            autoCapitalize="none"
            onChange={(e) => setPseudo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <input
            type="password"
            value={password}
            placeholder={mode === 'register' ? `Mot de passe (${MIN_PASSWORD_LENGTH} caractères min.)` : 'Mot de passe'}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />

          {error && <p className="errline">{error}</p>}

          <button disabled={!ready} onClick={submit}>
            {busy ? '…' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </button>
        </div>
      </div>

      <footer className="menufoot">Règles : contrat le plus bas gagne. 7 contrats, 28 manches.</footer>
    </div>
  );
}
