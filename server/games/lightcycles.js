import { BaseGame } from './BaseGame.js';
import { clamp, distSq, segmentsIntersect } from './math.js';

const BASE_W = 36;
const BASE_H = 24;
const SPEED = 11.8;
const BOOST_SPEED = 18.6;
const WIN_ROUNDS = 2;
const SHRINK_START = 22;

const DIRS = {
  right: { dx: 1, dz: 0, angle: 0 },
  down: { dx: 0, dz: 1, angle: Math.PI * 0.5 },
  left: { dx: -1, dz: 0, angle: Math.PI },
  up: { dx: 0, dz: -1, angle: -Math.PI * 0.5 },
};

const OPPOSITE = {
  right: 'left',
  left: 'right',
  up: 'down',
  down: 'up',
};

export class LightcyclesGame extends BaseGame {
  constructor() {
    super('lightcycles');
    this.scores = [0, 0];
    this.round = 1;
    this.roundPause = 0;
    this.roundWinner = null;
    this.roundElapsed = 0;
    this.halfW = BASE_W * 0.5;
    this.halfH = BASE_H * 0.5;
    this.bikes = [];
    this.pickups = [];
    this.nextId = 1;
    this.pickupTimer = 4;
    this._setupRound();
  }

  _setupRound() {
    this.roundPause = 0;
    this.roundWinner = null;
    this.roundElapsed = 0;
    this.halfW = BASE_W * 0.5;
    this.halfH = BASE_H * 0.5;
    this.pickups = [];
    this.pickupTimer = 4.0;

    this.bikes = [
      this._makeBike(0, -12, 0, 'right'),
      this._makeBike(1, 12, 0, 'left'),
    ];
  }

  _makeBike(index, x, z, dir) {
    return {
      index,
      x,
      z,
      dir,
      angle: DIRS[dir].angle,
      turnQueue: [],
      turnCooldown: 0,
      boostEnergy: 100,
      boosting: false,
      phaseTimer: 0,
      alive: true,
      trail: [{ x, z }],
    };
  }

  onPlayerInput(playerIndex, input) {
    if (playerIndex !== 0 && playerIndex !== 1) return;
    super.onPlayerInput(playerIndex, input);
    const bike = this.bikes[playerIndex];
    if (!bike || !bike.alive || this.roundPause > 0 || this.result) return;

    if (input.turn && DIRS[input.turn]) {
      const lastPlanned =
        bike.turnQueue.length > 0 ? bike.turnQueue[bike.turnQueue.length - 1] : bike.dir;
      if (input.turn !== lastPlanned && OPPOSITE[lastPlanned] !== input.turn && bike.turnQueue.length < 2) {
        bike.turnQueue.push(input.turn);
      }
    }
  }

  step(dt) {
    super.step(dt);
    if (this.result) return;

    if (this.roundPause > 0) {
      this.roundPause -= dt;
      if (this.roundPause <= 0) {
        this.round += 1;
        this._setupRound();
        this.emitEvent('round_start', { round: this.round });
      }
      return;
    }

    this.roundElapsed += dt;
    if (this.roundElapsed > SHRINK_START) {
      this.halfW = Math.max(6.5, this.halfW - dt * 0.42);
      this.halfH = Math.max(4.8, this.halfH - dt * 0.28);
    }

    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0 && this.pickups.length < 2) {
      this.pickupTimer = 6.5;
      this.pickups.push({
        id: `lp_${this.nextId++}`,
        kind: Math.random() > 0.45 ? 'phase' : 'charge',
        x: (Math.random() - 0.5) * (this.halfW * 1.4),
        z: (Math.random() - 0.5) * (this.halfH * 1.4),
      });
    }

    const prevPos = this.bikes.map((b) => ({ x: b.x, z: b.z }));

    // Advance bikes
    for (const bike of this.bikes) {
      if (!bike.alive) continue;
      bike.phaseTimer = Math.max(0, bike.phaseTimer - dt);
      bike.turnCooldown = Math.max(0, bike.turnCooldown - dt);

      if (bike.turnQueue.length > 0 && bike.turnCooldown <= 0) {
        const nextDir = bike.turnQueue.shift();
        if (OPPOSITE[bike.dir] !== nextDir && bike.dir !== nextDir) {
          bike.trail.push({ x: bike.x, z: bike.z });
          bike.dir = nextDir;
          bike.angle = DIRS[nextDir].angle;
          bike.turnCooldown = 0.08;
          this.emitEvent('bike_turn', { player: bike.index, x: bike.x, z: bike.z });
        }
      }

      const inp = this.inputs[bike.index] || {};
      const wantsBoost = Boolean(inp.boost);
      if (wantsBoost && bike.boostEnergy > 5) {
        bike.boosting = true;
        bike.boostEnergy = Math.max(0, bike.boostEnergy - dt * 42);
      } else {
        bike.boosting = false;
        bike.boostEnergy = Math.min(100, bike.boostEnergy + dt * 16);
      }

      const spd = bike.boosting ? BOOST_SPEED : SPEED;
      const v = DIRS[bike.dir];
      bike.x += v.dx * spd * dt;
      bike.z += v.dz * spd * dt;
    }

    // Collect pickups
    this.pickups = this.pickups.filter((pu) => {
      for (const bike of this.bikes) {
        if (!bike.alive) continue;
        if (distSq(bike.x, bike.z, pu.x, pu.z) <= 1.25 * 1.25) {
          if (pu.kind === 'phase') bike.phaseTimer = 1.8;
          else bike.boostEnergy = 100;
          this.emitEvent('powerup_pickup', { player: bike.index, kind: pu.kind, x: pu.x, z: pu.z });
          return false;
        }
      }
      return true;
    });

    // Check collisions (wall + trails + head-on)
    const crashed = [false, false];

    for (let i = 0; i < 2; i++) {
      const b = this.bikes[i];
      if (!b.alive) continue;

      if (Math.abs(b.x) >= this.halfW - 0.35 || Math.abs(b.z) >= this.halfH - 0.35) {
        crashed[i] = true;
        continue;
      }

      if (b.phaseTimer > 0) continue;

      const ax = prevPos[i].x;
      const az = prevPos[i].z;
      const bx = b.x;
      const bz = b.z;

      for (let j = 0; j < 2; j++) {
        const other = this.bikes[j];
        const pts = [...other.trail, { x: other.x, z: other.z }];
        // Skip the last 2 segments of own trail to prevent corner self-hit
        const limit = i === j ? pts.length - 3 : pts.length - 1;
        for (let k = 0; k < limit; k++) {
          if (segmentsIntersect(ax, az, bx, bz, pts[k].x, pts[k].z, pts[k + 1].x, pts[k + 1].z)) {
            crashed[i] = true;
            break;
          }
        }
        if (crashed[i]) break;
      }
    }

    // Head-on proximity check
    if (!crashed[0] && !crashed[1]) {
      if (distSq(this.bikes[0].x, this.bikes[0].z, this.bikes[1].x, this.bikes[1].z) <= 0.72 * 0.72) {
        crashed[0] = true;
        crashed[1] = true;
      }
    }

    if (crashed[0] || crashed[1]) {
      if (crashed[0]) {
        this.bikes[0].alive = false;
        this.emitEvent('bike_crash', { player: 0, x: this.bikes[0].x, z: this.bikes[0].z });
      }
      if (crashed[1]) {
        this.bikes[1].alive = false;
        this.emitEvent('bike_crash', { player: 1, x: this.bikes[1].x, z: this.bikes[1].z });
      }

      if (crashed[0] && crashed[1]) {
        this.roundWinner = -1;
        this.roundPause = 2.0;
      } else {
        const winner = crashed[0] ? 1 : 0;
        this.scores[winner] += 1;
        this.roundWinner = winner;
        if (this.scores[winner] >= WIN_ROUNDS) {
          this.result = {
            winner,
            reason: `Player ${winner + 1} won Lightcycle Duel ${this.scores[0]}–${this.scores[1]}`,
            scores: [...this.scores],
          };
        } else {
          this.roundPause = 2.0;
        }
      }
    }
  }

  computeBotInput(botIndex) {
    const me = this.bikes[botIndex];
    if (!me || !me.alive) return {};
    const v = DIRS[me.dir];
    const lookAhead = 3.2;
    const fx = me.x + v.dx * lookAhead;
    const fz = me.z + v.dz * lookAhead;

    let danger = Math.abs(fx) >= this.halfW - 1.2 || Math.abs(fz) >= this.halfH - 1.2;
    if (!danger) {
      for (let j = 0; j < 2; j++) {
        const other = this.bikes[j];
        const pts = [...other.trail, { x: other.x, z: other.z }];
        const limit = j === botIndex ? pts.length - 3 : pts.length - 1;
        for (let k = 0; k < limit; k++) {
          if (segmentsIntersect(me.x, me.z, fx, fz, pts[k].x, pts[k].z, pts[k + 1].x, pts[k + 1].z)) {
            danger = true;
            break;
          }
        }
      }
    }

    if (danger || Math.random() < 0.018) {
      const options = Object.keys(DIRS).filter((d) => d !== me.dir && d !== OPPOSITE[me.dir]);
      // Prefer turning toward center
      options.sort((a, b) => {
        const da = DIRS[a];
        const db = DIRS[b];
        const distA = Math.hypot(me.x + da.dx * 3, me.z + da.dz * 3);
        const distB = Math.hypot(me.x + db.dx * 3, me.z + db.dz * 3);
        return distA - distB;
      });
      return { turn: options[0], boost: false };
    }
    return { boost: me.boostEnergy > 65 && Math.random() < 0.08 };
  }

  getState() {
    return {
      gameId: this.id,
      arena: { halfW: this.halfW, halfH: this.halfH, baseW: BASE_W, baseH: BASE_H },
      round: this.round,
      winRounds: WIN_ROUNDS,
      scores: this.scores,
      roundWinner: this.roundWinner,
      roundPause: this.roundPause,
      shrinking: this.roundElapsed > SHRINK_START,
      bikes: this.bikes.map((b) => ({
        index: b.index,
        x: b.x,
        z: b.z,
        dir: b.dir,
        angle: b.angle,
        boostEnergy: Math.round(b.boostEnergy),
        boosting: b.boosting,
        phase: b.phaseTimer > 0,
        alive: b.alive,
        trail: [...b.trail, { x: b.x, z: b.z }],
      })),
      pickups: this.pickups,
    };
  }
}
