import { Server, routePartykitRequest, type Connection, type WSMessage } from 'partyserver';
import { GameRoom, type Conn } from './core.js';

// Réexporté pour les tests (délais d'animation mutables).
export { TIMING } from './core.js';

/** Bindings Workers (voir wrangler.jsonc). */
interface Env {
  Main: DurableObjectNamespace<BarbuServer>;
}

/**
 * Adaptateur partyserver : une salle Barbu = une Durable Object Cloudflare.
 * Toute la logique de jeu vit dans `GameRoom` (agnostique du transport) ; cette
 * classe ne fait que relier les entrées partyserver à la salle et lui fournir
 * l'identité (nom de salle) + les connexions vivantes.
 */
export class BarbuServer extends Server<Env> {
  private room: GameRoom;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const server = this;
    this.room = new GameRoom({
      get id() {
        return server.name;
      },
      getConnections: () => server.getConnections() as Iterable<Conn>,
    });
  }

  override onConnect(conn: Connection) {
    this.room.onConnect(conn);
  }

  override onMessage(conn: Connection, message: WSMessage) {
    // Le protocole est du JSON texte ; on ignore tout binaire éventuel.
    this.room.onMessage(typeof message === 'string' ? message : '', conn);
  }

  override onClose(conn: Connection) {
    this.room.onClose(conn);
  }
}

/** Point d'entrée Worker : route /parties/main/:code vers la Durable Object. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ?? new Response('Not found', { status: 404 })
    );
  },
};
