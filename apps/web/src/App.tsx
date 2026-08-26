import { useState } from 'react';
import { Menu, type Screen } from './Menu.js';
import { AppShell, type Tab } from './Shell.js';
import { RulesScreen } from './RulesScreen.js';
import { SoloScreen } from './solo/SoloScreen.js';
import { OnlineScreen } from './online/OnlineScreen.js';
import { SettingsScreen } from './settings/SettingsScreen.js';
import { SocialScreen } from './social/SocialScreen.js';
import { AuthScreen } from './auth/AuthScreen.js';
import { useAuth } from './auth/useAuth.js';
import { usePresence } from './social/useSocial.js';

const TAB_TO_SCREEN: Record<Tab, Screen> = {
  home: 'menu',
  profile: 'settings',
  friends: 'social',
  rules: 'rules',
};
const SCREEN_TO_TAB: Partial<Record<Screen, Tab>> = {
  menu: 'home',
  settings: 'profile',
  social: 'friends',
  rules: 'rules',
};

export function App() {
  const auth = useAuth();
  const [screen, setScreen] = useState<Screen>('menu');
  // Id de partie solo à reprendre directement (déclenché depuis les réglages).
  const [soloResume, setSoloResume] = useState<string | null>(null);
  // Salle en ligne à rejoindre d'emblée (depuis l'historique des parties).
  const [joinRoom, setJoinRoom] = useState<string | null>(null);
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

  // Écrans plein écran (hors coquille).
  if (screen === 'solo') {
    return (
      <SoloScreen
        onBack={() => { setSoloResume(null); back(); }}
        token={auth.token}
        initialResumeId={soloResume}
      />
    );
  }
  if (screen === 'online') {
    return (
      <OnlineScreen
        onBack={() => { setJoinRoom(null); back(); }}
        account={auth.account}
        token={auth.token}
        initialRoom={joinRoom}
      />
    );
  }

  // Hub à onglets : jouer / profil / amis / règles.
  const tab = SCREEN_TO_TAB[screen] ?? 'home';
  return (
    <AppShell tab={tab} onTab={(t) => setScreen(TAB_TO_SCREEN[t])}>
      {screen === 'settings' ? (
        <SettingsScreen
          auth={auth}
          onResumeGame={(id) => { setSoloResume(id); setScreen('solo'); }}
        />
      ) : screen === 'social' ? (
        <SocialScreen
          token={auth.token}
          me={auth.account}
          onJoinRoom={(code) => { setJoinRoom(code); setScreen('online'); }}
        />
      ) : screen === 'rules' ? (
        <RulesScreen />
      ) : (
        <Menu onPick={setScreen} auth={auth} />
      )}
    </AppShell>
  );
}
