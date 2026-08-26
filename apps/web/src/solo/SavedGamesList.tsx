import type { SavedGame } from '@barbu/engine';
import type { SoloSave } from './useSoloGame.js';
import { asSoloSave, describeSave } from './soloSave.js';

/**
 * Liste des parties solo en cours : reprendre ou supprimer. Partagée par
 * l'écran Solo (« Reprendre ») et les réglages (« Mes parties »).
 */
export function SavedGamesList({
  saves,
  loading,
  onResume,
  onDelete,
  empty,
}: {
  saves: SavedGame[];
  loading: boolean;
  onResume: (id: string, save: SoloSave) => void;
  onDelete: (id: string) => void;
  empty?: string;
}) {
  const games = saves
    .map((s) => ({ raw: s, save: asSoloSave(s.state) }))
    .filter((g): g is { raw: SavedGame; save: SoloSave } => g.save !== null);

  if (loading) return <p className="muted">Chargement…</p>;
  if (games.length === 0) return <p className="muted">{empty ?? 'Aucune partie en cours.'}</p>;

  return (
    <div className="savedlist">
      {games.map(({ raw, save }) => {
        const d = describeSave(save, raw.updatedAt);
        return (
          <div key={raw.id} className="savedrow">
            <button className="savedmain" onClick={() => onResume(raw.id, save)}>
              <span className="savedlevel">{d.level}</span>
              <span className="savedmeta">
                Manche {d.manche}/{d.total}
                {d.when && ` · ${d.when}`}
              </span>
            </button>
            <button className="ghost tiny danger" onClick={() => onDelete(raw.id)} title="Supprimer cette partie">
              Supprimer
            </button>
          </div>
        );
      })}
    </div>
  );
}
