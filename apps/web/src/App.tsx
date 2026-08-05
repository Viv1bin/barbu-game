import { useState } from 'react';
import { Menu, type Screen } from './Menu.js';
import { SoloScreen } from './solo/SoloScreen.js';
import { OnlineScreen } from './online/OnlineScreen.js';
import { SettingsScreen } from './settings/SettingsScreen.js';
import { SocialScreen } from './social/SocialScreen.js';
import { AuthScreen } from './auth/AuthScreen.js';
import { useAuth } from './auth/useAuth.js';
import { usePresence } from './social/useSocial.js';

export function App() {
  const auth = useAuth();
  const [screen, setScreen] = useState<Screen>('menu');
  const back = () => setScreen('menu');
  // Présence globale : on est « en ligne » pour nos amis tant que l'app est ouverte.
  usePresence(auth.token);

  if (auth.loading) {
    return (
      <div className="menu">
        <div className="hero">
          <h1>Barbu</h1>
          <p>Chargement…</p>
        </div>
      </div>
    );
  }
  if (!auth.account) return <AuthScreen auth={auth} />;

  if (screen === 'solo') return <SoloScreen onBack={back} token={auth.token} />;
  if (screen === 'online') return <OnlineScreen onBack={back} account={auth.account} />;
  if (screen === 'social') return <SocialScreen onBack={back} token={auth.token} me={auth.account} />;
  if (screen === 'settings') return <SettingsScreen onBack={back} auth={auth} />;
  return <Menu onPick={setScreen} auth={auth} />;
}
