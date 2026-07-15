import { useState } from 'react';
import { Menu, type Screen } from './Menu.js';
import { SoloScreen } from './solo/SoloScreen.js';
import { ArbiterScreen } from './arbiter/ArbiterScreen.js';
import { SettingsScreen } from './settings/SettingsScreen.js';

export function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const back = () => setScreen('menu');

  if (screen === 'solo') return <SoloScreen onBack={back} />;
  if (screen === 'arbiter') return <ArbiterScreen onBack={back} />;
  if (screen === 'settings') return <SettingsScreen onBack={back} />;
  return <Menu onPick={setScreen} />;
}
