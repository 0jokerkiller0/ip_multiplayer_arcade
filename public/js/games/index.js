import { TankArenaRenderer } from './tankArenaRenderer.js';
import { LightcyclesRenderer } from './lightcyclesRenderer.js';
import { AirHockeyRenderer } from './airHockeyRenderer.js';
import { BattleshipRenderer } from './battleshipRenderer.js';
import { RooftopDuelRenderer } from './rooftopDuelRenderer.js';

/**
 * Client renderer registry.
 * Add new 3D game renderers here using the matching server gameId.
 */
export const RENDERER_MAP = {
  tank_arena: (sceneMgr) => new TankArenaRenderer(sceneMgr),
  lightcycles: (sceneMgr) => new LightcyclesRenderer(sceneMgr),
  air_hockey: (sceneMgr) => new AirHockeyRenderer(sceneMgr),
  battleship: (sceneMgr, sendAction) => new BattleshipRenderer(sceneMgr, sendAction),
  rooftop_duel: (sceneMgr) => new RooftopDuelRenderer(sceneMgr),
};
