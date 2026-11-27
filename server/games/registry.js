import { TankArenaGame } from './tankArena.js';
import { LightcyclesGame } from './lightcycles.js';
import { AirHockeyGame } from './airHockey.js';
import { BattleshipGame } from './battleship.js';
import { RooftopDuelGame } from './rooftopDuel.js';

/**
 * Central game registry.
 * To add a new game to the IP Multiplayer Arcade:
 *   1. Create server/games/myGame.js extending BaseGame.
 *   2. Register its metadata and factory function below.
 *   3. Create public/js/games/myGameRenderer.js and register it in public/js/games/index.js.
 */
export const GAME_REGISTRY = [
  {
    id: 'tank_arena',
    title: 'Ricochet Tank Arena',
    subtitle: '3D Tactical Armor Combat',
    tagline: 'Bouncing shells, destructible crates, power-ups & dash boosts.',
    accent: '#00e5ff',
    controls: 'WASD / Arrows: Drive • Mouse: Aim • Click / Space: Fire • Shift: Dash',
    winCondition: 'First to 2 rounds',
    create: () => new TankArenaGame(),
  },
  {
    id: 'lightcycles',
    title: 'Neon Lightcycle Duel',
    subtitle: 'High-Speed Grid Survival',
    tagline: 'Carve hard-light trails, phase through walls, outlast the shrinking arena.',
    accent: '#ff3b7f',
    controls: 'WASD / Arrows: 90° Turn • Space / Shift: Turbo Boost',
    winCondition: 'First to 2 rounds',
    create: () => new LightcyclesGame(),
  },
  {
    id: 'air_hockey',
    title: 'Hyper Air Hockey',
    subtitle: 'Physics Rink & Chaos Mods',
    tagline: 'Sub-stepped striker physics with multi-puck & giant-paddle modifiers.',
    accent: '#ffb300',
    controls: 'Mouse (or WASD / Arrows): Glide Striker',
    winCondition: 'First to 7 goals',
    create: () => new AirHockeyGame(),
  },
  {
    id: 'battleship',
    title: 'Tactical Radar Battleship',
    subtitle: 'Naval Warfare & Bluffing',
    tagline: 'Place your fleet, scan with Sonar, call Airstrikes & deploy EMP Shields.',
    accent: '#38bdf8',
    controls: 'Click Grid: Place / Fire • R: Rotate Ship • Ability Buttons: Special Ops',
    winCondition: 'Sink all 5 enemy ships',
    create: () => new BattleshipGame(),
  },
  {
    id: 'rooftop_duel',
    title: 'Rooftop Weapon Duel',
    subtitle: '2.5D Cyber Skyline Brawl',
    tagline: 'Double-jump, air-dash, grab Lasers, Rockets, Grenades & Plasma Blades.',
    accent: '#a855f7',
    controls: 'A/D: Move • W/Space: Double Jump • S: Drop • Mouse: Aim/Fire • Shift: Dash',
    winCondition: 'First to 3 KOs',
    create: () => new RooftopDuelGame(),
  },
];

export function getGameEntry(gameId) {
  return GAME_REGISTRY.find((g) => g.id === gameId) || null;
}

export function getPublicCatalog() {
  return GAME_REGISTRY.map(({ create: _c, ...meta }) => meta);
}
