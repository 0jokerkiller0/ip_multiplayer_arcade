/**
 * Base class for all server-authoritative 2-player games.
 * Extend this class when adding a new game mode to the arcade hub.
 */
export class BaseGame {
  constructor(id) {
    this.id = id;
    this.elapsed = 0;
    this.result = null;
    this.inputs = [{}, {}];
    this.pendingEvents = [];
  }

  /** Called once when the match begins. */
  onStart() {}

  /** Stores latest real-time input state or processes discrete actions. */
  onPlayerInput(playerIndex, input) {
    if (playerIndex !== 0 && playerIndex !== 1) return;
    this.inputs[playerIndex] = { ...this.inputs[playerIndex], ...input };
  }

  /** Emits a transient visual/audio event to clients on next state broadcast. */
  emitEvent(type, payload = {}) {
    this.pendingEvents.push({ type, ...payload });
  }

  /** Consumes and returns queued events since last broadcast. */
  drainEvents() {
    if (this.pendingEvents.length === 0) return [];
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }

  /** Advances the simulation by dt seconds (fixed 60Hz tick). */
  step(dt) {
    this.elapsed += dt;
  }

  /** Optional lightweight bot AI input generator for solo practice mode. */
  computeBotInput(_botIndex) {
    return {};
  }

  /**
   * Returns serializable game state for a given viewer:
   * playerIndex = 0, 1, or -1 (spectator).
   */
  getState(_forPlayerIndex) {
    throw new Error('getState() must be implemented by subclass');
  }

  /** Returns null while match is active, or { winner, reason, scores }. */
  getResult() {
    return this.result;
  }
}
