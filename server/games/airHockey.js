import { BaseGame } from './BaseGame.js';
import { clamp, distSq } from './math.js';

const RINK_W = 12;
const RINK_L = 20;
const HALF_W = RINK_W * 0.5;
const HALF_L = RINK_L * 0.5;
const GOAL_HALF = 2.25;
const PUCK_R = 0.48;
const BASE_PADDLE_R = 0.88;
const MAX_PADDLE_SPD = 25;
const MAX_PUCK_SPD = 28;
const WIN_GOALS = 7;

const GOAL_POSTS = [
  { x: -GOAL_HALF, z: -HALF_L },
  { x: GOAL_HALF, z: -HALF_L },
  { x: -GOAL_HALF, z: HALF_L },
  { x: GOAL_HALF, z: HALF_L },
];

const MOD_KINDS = ['giant', 'tinyEnemy', 'multiPuck', 'speedPuck'];

export class AirHockeyGame extends BaseGame {
  constructor() {
    super('air_hockey');
    this.scores = [0, 0];
    this.goalPause = 0;
    this.lastScorer = null;
    this.nextId = 1;
    this.modTimer = 7.5;
    this.modifiers = [];
    this.paddles = [
      this._makePaddle(0, 0, -6.5),
      this._makePaddle(1, 0, 6.5),
    ];
    this.pucks = [];
    this._resetPuck(Math.random() > 0.5 ? 0 : 1);
  }

  _makePaddle(index, x, z) {
    return {
      index,
      x,
      z,
      vx: 0,
      vz: 0,
      radius: BASE_PADDLE_R,
      bigTimer: 0,
      tinyTimer: 0,
    };
  }

  _resetPuck(serveTo) {
    const dir = serveTo === 0 ? -1 : 1;
    this.pucks = [
      {
        id: `pk_${this.nextId++}`,
        x: 0,
        z: dir * 1.8,
        vx: (Math.random() - 0.5) * 4.0,
        vz: dir * 3.5,
        golden: false,
        speedBoostTimer: 0,
      },
    ];
  }

  step(dt) {
    super.step(dt);
    if (this.result) return;

    if (this.goalPause > 0) {
      this.goalPause -= dt;
      if (this.goalPause <= 0) {
        this._resetPuck(this.lastScorer === 0 ? 1 : 0);
        this.emitEvent('faceoff', {});
      }
      return;
    }

    // Spawn center-line chaos modifiers
    this.modTimer -= dt;
    if (this.modTimer <= 0 && this.modifiers.length < 1) {
      this.modTimer = 9.0;
      const kind = MOD_KINDS[Math.floor(Math.random() * MOD_KINDS.length)];
      this.modifiers.push({
        id: `mod_${this.nextId++}`,
        kind,
        x: (Math.random() - 0.5) * (RINK_W - 3.0),
        z: (Math.random() - 0.5) * 2.2,
      });
    }

    // Update paddles
    for (const p of this.paddles) {
      p.bigTimer = Math.max(0, p.bigTimer - dt);
      p.tinyTimer = Math.max(0, p.tinyTimer - dt);
      p.radius = BASE_PADDLE_R * (p.bigTimer > 0 ? 1.42 : 1) * (p.tinyTimer > 0 ? 0.65 : 1);

      const inp = this.inputs[p.index] || {};
      const minZ = p.index === 0 ? -HALF_L + p.radius + 0.2 : p.radius + 0.35;
      const maxZ = p.index === 0 ? -p.radius - 0.35 : HALF_L - p.radius - 0.2;

      let targetX = p.x;
      let targetZ = p.z;
      if (Number.isFinite(inp.targetX) && Number.isFinite(inp.targetZ)) {
        targetX = inp.targetX;
        targetZ = inp.targetZ;
      } else {
        const mx = clamp(Number(inp.moveX) || 0, -1, 1);
        const mz = clamp(Number(inp.moveZ) || 0, -1, 1);
        targetX = p.x + mx * 16 * dt;
        targetZ = p.z + mz * 16 * dt;
      }

      targetX = clamp(targetX, -HALF_W + p.radius, HALF_W - p.radius);
      targetZ = clamp(targetZ, minZ, maxZ);

      const dx = targetX - p.x;
      const dz = targetZ - p.z;
      const dist = Math.hypot(dx, dz);
      const maxStep = MAX_PADDLE_SPD * dt;
      const nx = dist > maxStep && dist > 0 ? p.x + (dx / dist) * maxStep : targetX;
      const nz = dist > maxStep && dist > 0 ? p.z + (dz / dist) * maxStep : targetZ;

      p.vx = (nx - p.x) / dt;
      p.vz = (nz - p.z) / dt;
      p.x = nx;
      p.z = nz;
    }

    // Sub-stepped puck physics
    const subSteps = 8;
    const subDt = dt / subSteps;
    let scoredBy = null;

    for (const puck of this.pucks) {
      puck.speedBoostTimer = Math.max(0, puck.speedBoostTimer - dt);
      for (let s = 0; s < subSteps; s++) {
        puck.x += puck.vx * subDt;
        puck.z += puck.vz * subDt;

        // Air table low friction
        const drag = Math.pow(0.988, subDt * 60);
        puck.vx *= drag;
        puck.vz *= drag;

        // Side walls
        if (puck.x - PUCK_R < -HALF_W) {
          puck.x = -HALF_W + PUCK_R;
          puck.vx = Math.abs(puck.vx) * 0.96;
          this.emitEvent('wall_clack', { x: puck.x, z: puck.z });
        } else if (puck.x + PUCK_R > HALF_W) {
          puck.x = HALF_W - PUCK_R;
          puck.vx = -Math.abs(puck.vx) * 0.96;
          this.emitEvent('wall_clack', { x: puck.x, z: puck.z });
        }

        // Goal check or end wall bounce
        if (puck.z - PUCK_R < -HALF_L) {
          if (Math.abs(puck.x) < GOAL_HALF - PUCK_R * 0.35) {
            if (puck.z < -HALF_L - PUCK_R * 0.4) {
              scoredBy = 1; // Player 1 scored into Player 0's goal (-Z)
              break;
            }
          } else {
            puck.z = -HALF_L + PUCK_R;
            puck.vz = Math.abs(puck.vz) * 0.96;
            this.emitEvent('wall_clack', { x: puck.x, z: puck.z });
          }
        } else if (puck.z + PUCK_R > HALF_L) {
          if (Math.abs(puck.x) < GOAL_HALF - PUCK_R * 0.35) {
            if (puck.z > HALF_L + PUCK_R * 0.4) {
              scoredBy = 0; // Player 0 scored into Player 1's goal (+Z)
              break;
            }
          } else {
            puck.z = HALF_L - PUCK_R;
            puck.vz = -Math.abs(puck.vz) * 0.96;
            this.emitEvent('wall_clack', { x: puck.x, z: puck.z });
          }
        }

        // Goalpost circle collisions
        for (const post of GOAL_POSTS) {
          const postR = 0.22;
          const minD = PUCK_R + postR;
          const dx = puck.x - post.x;
          const dz = puck.z - post.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 0 && d2 < minD * minD) {
            const d = Math.sqrt(d2);
            const nx = dx / d;
            const nz = dz / d;
            puck.x = post.x + nx * minD;
            puck.z = post.z + nz * minD;
            const dot = puck.vx * nx + puck.vz * nz;
            if (dot < 0) {
              puck.vx -= 2 * dot * nx;
              puck.vz -= 2 * dot * nz;
            }
          }
        }

        // Paddle collisions
        for (const p of this.paddles) {
          const minD = PUCK_R + p.radius;
          const dx = puck.x - p.x;
          const dz = puck.z - p.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < minD * minD) {
            const d = Math.sqrt(d2) || 0.001;
            const nx = dx / d;
            const nz = dz / d;
            puck.x = p.x + nx * (minD + 0.01);
            puck.z = p.z + nz * (minD + 0.01);

            const rvx = puck.vx - p.vx;
            const rvz = puck.vz - p.vz;
            const relNormal = rvx * nx + rvz * nz;
            if (relNormal < 0) {
              const restitution = 1.04;
              puck.vx -= (1 + restitution) * relNormal * nx * 0.65;
              puck.vz -= (1 + restitution) * relNormal * nz * 0.65;
              puck.vx += p.vx * 0.42;
              puck.vz += p.vz * 0.42;
              const spd = Math.hypot(puck.vx, puck.vz);
              const cap = puck.speedBoostTimer > 0 ? MAX_PUCK_SPD * 1.25 : MAX_PUCK_SPD;
              if (spd > cap) {
                puck.vx = (puck.vx / spd) * cap;
                puck.vz = (puck.vz / spd) * cap;
              } else if (spd < 6.5) {
                const factor = 6.5 / (spd || 1);
                puck.vx *= factor;
                puck.vz *= factor;
              }
              this.emitEvent('paddle_hit', { player: p.index, x: puck.x, z: puck.z, speed: spd });
            }
          }
        }
      }
      if (scoredBy !== null) break;

      // Modifier pickups by puck
      this.modifiers = this.modifiers.filter((mod) => {
        if (distSq(puck.x, puck.z, mod.x, mod.z) <= (PUCK_R + 0.72) ** 2) {
          const owner = puck.vz >= 0 ? 0 : 1; // player who knocked puck into modifier
          const other = owner === 0 ? 1 : 0;
          if (mod.kind === 'giant') this.paddles[owner].bigTimer = 7.5;
          else if (mod.kind === 'tinyEnemy') this.paddles[other].tinyTimer = 7.5;
          else if (mod.kind === 'speedPuck') {
            puck.speedBoostTimer = 6.0;
            puck.vx *= 1.35;
            puck.vz *= 1.35;
          } else if (mod.kind === 'multiPuck' && this.pucks.length < 3) {
            this.pucks.push({
              id: `pk_${this.nextId++}`,
              x: mod.x,
              z: mod.z,
              vx: -puck.vx * 0.85,
              vz: -puck.vz * 0.85,
              golden: true,
              speedBoostTimer: 0,
            });
          }
          this.emitEvent('powerup_pickup', { player: owner, kind: mod.kind, x: mod.x, z: mod.z });
          return false;
        }
        return true;
      });
    }

    if (scoredBy !== null) {
      this.scores[scoredBy] += 1;
      this.lastScorer = scoredBy;
      this.emitEvent('goal_scored', { scorer: scoredBy, scores: [...this.scores] });
      if (this.scores[scoredBy] >= WIN_GOALS) {
        this.result = {
          winner: scoredBy,
          reason: `Player ${scoredBy + 1} won Hyper Air Hockey ${this.scores[0]}–${this.scores[1]}`,
          scores: [...this.scores],
        };
      } else {
        this.goalPause = 1.65;
      }
    }
  }

  computeBotInput(botIndex) {
    const puck = this.pucks[0];
    if (!puck) return {};
    const homeZ = botIndex === 0 ? -7.2 : 7.2;
    const defendLine = botIndex === 0 ? -4.2 : 4.2;
    const inMyHalf = botIndex === 0 ? puck.z < 0.5 : puck.z > -0.5;
    const targetZ = inMyHalf ? clamp(puck.z + (botIndex === 0 ? -0.5 : 0.5), -9.0, 9.0) : homeZ;
    const targetX = inMyHalf ? clamp(puck.x, -4.8, 4.8) : clamp(puck.x * 0.55, -2.1, 2.1);
    return { targetX, targetZ: botIndex === 0 ? Math.min(targetZ, defendLine) : Math.max(targetZ, defendLine) };
  }

  getState() {
    return {
      gameId: this.id,
      rink: { w: RINK_W, l: RINK_L, goalHalf: GOAL_HALF },
      scores: this.scores,
      winGoals: WIN_GOALS,
      goalPause: this.goalPause,
      lastScorer: this.lastScorer,
      paddles: this.paddles.map((p) => ({
        index: p.index,
        x: p.x,
        z: p.z,
        radius: p.radius,
        big: p.bigTimer > 0,
        tiny: p.tinyTimer > 0,
      })),
      pucks: this.pucks.map((pk) => ({
        id: pk.id,
        x: pk.x,
        z: pk.z,
        vx: pk.vx,
        vz: pk.vz,
        radius: PUCK_R,
        golden: pk.golden,
        fast: pk.speedBoostTimer > 0,
      })),
      modifiers: this.modifiers,
    };
  }
}
