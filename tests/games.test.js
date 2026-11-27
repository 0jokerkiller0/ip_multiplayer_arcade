import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCircleAABB, reflectVelocity, segmentsIntersect } from '../server/games/math.js';
import { TankArenaGame } from '../server/games/tankArena.js';
import { LightcyclesGame } from '../server/games/lightcycles.js';
import { AirHockeyGame } from '../server/games/airHockey.js';
import { BattleshipGame } from '../server/games/battleship.js';
import { RooftopDuelGame } from '../server/games/rooftopDuel.js';

test('Math helpers: resolveCircleAABB, reflectVelocity, segmentsIntersect', () => {
  const res = resolveCircleAABB(0.9, 0, 0.5, { x: 0, z: 0, w: 2, h: 2 });
  assert.equal(res.hit, true);
  assert.ok(res.x >= 1.49);

  const refl = reflectVelocity(10, -5, -1, 0);
  assert.equal(refl.vx, -10);
  assert.equal(refl.vz, -5);

  assert.equal(segmentsIntersect(-2, 0, 2, 0, 0, -2, 0, 2), true);
  assert.equal(segmentsIntersect(-2, 1, 2, 1, 0, -2, 0, 0), false);
});

test('TankArenaGame: ricochet bounce, hit, and round victory', () => {
  const g = new TankArenaGame();
  g.obstacles = [];
  g.tanks[0].x = 0;
  g.tanks[0].z = -7.5;
  g.tanks[0].turretAngle = -Math.PI * 0.5;
  g.onPlayerInput(0, { fire: true, aimX: 0, aimZ: -12 });
  g.step(1 / 60);
  assert.equal(g.bullets.length, 1);

  // Step until bullet hits top wall (-9) and bounces back downward (+vz)
  for (let i = 0; i < 40; i++) g.step(1 / 60);
  assert.ok(g.bullets[0].vz > 0, 'Bullet should ricochet off top wall');
  assert.equal(g.bullets[0].bouncesLeft, 1);

  // Direct lethal damage check
  g.tanks[1].hp = 1;
  g.bullets = [{ id: 'testb', owner: 0, x: g.tanks[1].x, z: g.tanks[1].z, vx: 0, vz: 0, bouncesLeft: 1, age: 0.5 }];
  g.step(1 / 60);
  assert.equal(g.scores[0], 1);
  assert.equal(g.roundWinner, 0);
});

test('LightcyclesGame: prevents 180-degree self-reversal and detects wall/trail crash', () => {
  const g = new LightcyclesGame();
  assert.equal(g.bikes[0].dir, 'right');
  g.onPlayerInput(0, { turn: 'left' });
  g.step(1 / 60);
  assert.equal(g.bikes[0].dir, 'right', 'Must ignore 180-degree turn');

  g.onPlayerInput(0, { turn: 'up' });
  g.step(1 / 60);
  assert.equal(g.bikes[0].dir, 'up');

  // Force wall crash for bike 0
  g.bikes[0].z = -11.9;
  g.step(1 / 60);
  assert.equal(g.bikes[0].alive, false);
  assert.equal(g.scores[1], 1);
});

test('AirHockeyGame: paddle bounds, wall bounce, and goal scoring', () => {
  const g = new AirHockeyGame();
  g.onPlayerInput(0, { targetX: 0, targetZ: 8 }); // Attempt to cross center line into P1 half
  for (let i = 0; i < 60; i++) g.step(1 / 60);
  assert.ok(g.paddles[0].z < 0, 'Player 0 paddle must remain in negative Z half');

  // Place puck right in front of P0 goal moving toward -Z
  g.pucks = [{ id: 'pk', x: 0, z: -9.6, vx: 0, vz: -18, golden: false, speedBoostTimer: 0 }];
  for (let i = 0; i < 10; i++) g.step(1 / 60);
  assert.equal(g.scores[1], 1, 'Player 1 should score into -Z goal');
});

test('BattleshipGame: anti-cheat fog-of-war, EMP shield, and sink victory', () => {
  const g = new BattleshipGame();
  const stateP0 = g.getState(0);
  assert.equal(stateP0.myShips.length, 5);
  assert.equal(stateP0.enemySunkShips.length, 0);
  assert.equal(stateP0.enemyShots[0][0], null);

  // Lock both fleets
  g.onPlayerInput(0, { action: 'lock' });
  g.onPlayerInput(1, { action: 'lock' });
  assert.equal(g.phase, 'combat');

  // P0 deploys shield? No, shield targets own board
  g.onPlayerInput(0, { action: 'fire', ability: 'shield', r: 0, c: 0 });
  assert.equal(g.boards[0].shields.length, 1);
  assert.equal(g.turn, 1);

  // P1 fires at (0,0) -> should be absorbed by EMP shield
  g.onPlayerInput(1, { action: 'fire', ability: 'strike', r: 0, c: 0 });
  assert.equal(g.boards[0].incomingShots[0][0], 'shielded');
  assert.equal(g.boards[0].shields.length, 0);

  // P0 sinks all P1 ships except last cell, then sinks last cell
  for (const ship of g.boards[1].ships) {
    for (let i = 0; i < ship.cells.length; i++) {
      const cell = ship.cells[i];
      if (ship === g.boards[1].ships[4] && i === ship.cells.length - 1) continue;
      cell.hit = true;
      g.boards[1].incomingShots[cell.r][cell.c] = 'hit';
    }
    ship.sunk = ship !== g.boards[1].ships[4];
  }
  const lastCell = g.boards[1].ships[4].cells.at(-1);
  g.onPlayerInput(0, { action: 'fire', ability: 'strike', r: lastCell.r, c: lastCell.c });
  assert.ok(g.getResult(), 'Game should end when all 5 enemy ships sink');
  assert.equal(g.getResult().winner, 0);
});

test('RooftopDuelGame: gravity, platform landing, double jump, and KO', () => {
  const g = new RooftopDuelGame();
  const f0 = g.fighters[0];
  f0.y = 4.0;
  f0.vy = 0;
  f0.x = -7.0; // above left_mid platform at y = 3.1
  for (let i = 0; i < 40; i++) g.step(1 / 60);
  assert.ok(Math.abs(f0.y - 3.1) < 0.05, 'Fighter should land on elevated platform');
  assert.equal(f0.grounded, true);

  // Fall off edge -> KO
  f0.x = -14;
  f0.y = -4.5;
  g.step(1 / 60);
  assert.equal(f0.alive, false);
  assert.equal(g.scores[1], 1);
});
