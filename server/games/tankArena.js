import { BaseGame } from './BaseGame.js';
import { clamp, distSq, reflectVelocity, resolveCircleAABB } from './math.js';

const ARENA_W = 28;
const ARENA_H = 18;
const HALF_W = ARENA_W * 0.5;
const HALF_H = ARENA_H * 0.5;

const TANK_RADIUS = 0.88;
const TANK_SPEED = 7.4;
const DASH_SPEED = 18.5;
const DASH_DURATION = 0.16;
const DASH_COOLDOWN = 2.0;
const FIRE_COOLDOWN = 0.42;
const BULLET_RADIUS = 0.22;
const BULLET_SPEED = 15.8;
const MAX_BOUNCES = 2;
const WIN_ROUNDS = 2;

const STATIC_BLOCKS = [
  { id: 'c_top', x: 0, z: -4.2, w: 2.8, h: 1.4, destructible: false },
  { id: 'c_bot', x: 0, z: 4.2, w: 2.8, h: 1.4, destructible: false },
  { id: 'l_pillar', x: -5.4, z: 0, w: 1.4, h: 4.6, destructible: false },
  { id: 'r_pillar', x: 5.4, z: 0, w: 1.4, h: 4.6, destructible: false },
];

const CRATE_SPOTS = [
  { x: 0, z: 0 },
  { x: -5.4, z: -5.2 },
  { x: -5.4, z: 5.2 },
  { x: 5.4, z: -5.2 },
  { x: 5.4, z: 5.2 },
  { x: -9.5, z: -3.5 },
  { x: -9.5, z: 3.5 },
  { x: 9.5, z: -3.5 },
  { x: 9.5, z: 3.5 },
];

const POWERUP_TYPES = ['shield', 'triple', 'rapid', 'speed'];

export class TankArenaGame extends BaseGame {
  constructor() {
    super('tank_arena');
    this.scores = [0, 0];
    this.round = 1;
    this.roundPause = 0;
    this.roundWinner = null;
    this.nextId = 1;
    this.powerupTimer = 4.5;
    this.tanks = [];
    this.obstacles = [];
    this.bullets = [];
    this.powerups = [];
    this._setupRound();
  }

  _setupRound() {
    this.roundWinner = null;
    this.roundPause = 0;
    this.bullets = [];
    this.powerups = [];
    this.powerupTimer = 3.5;

    this.obstacles = [
      ...STATIC_BLOCKS.map((b) => ({ ...b, hp: 999, maxHp: 999 })),
      ...CRATE_SPOTS.map((c, idx) => ({
        id: `crate_${idx}`,
        x: c.x,
        z: c.z,
        w: 1.45,
        h: 1.45,
        destructible: true,
        hp: 2,
        maxHp: 2,
      })),
    ];

    this.tanks = [
      this._makeTank(0, -10.8, 0, 0),
      this._makeTank(1, 10.8, 0, Math.PI),
    ];
  }

  _makeTank(index, x, z, angle) {
    return {
      index,
      x,
      z,
      bodyAngle: angle,
      turretAngle: angle,
      hp: 3,
      maxHp: 3,
      shield: false,
      tripleAmmo: 0,
      rapidTimer: 0,
      speedTimer: 0,
      fireCd: 0,
      dashCd: 0,
      dashTimer: 0,
      dashVx: 0,
      dashVz: 0,
      hitFlash: 0,
      alive: true,
    };
  }

  onPlayerInput(playerIndex, input) {
    if (playerIndex !== 0 && playerIndex !== 1) return;
    super.onPlayerInput(playerIndex, input);
    const tank = this.tanks[playerIndex];
    if (!tank || !tank.alive || this.roundPause > 0 || this.result) return;

    if (input.dash && tank.dashCd <= 0 && tank.dashTimer <= 0) {
      let dx = Number(input.moveX) || 0;
      let dz = Number(input.moveZ) || 0;
      const len = Math.hypot(dx, dz);
      if (len > 0.1) {
        dx /= len;
        dz /= len;
      } else {
        dx = Math.cos(tank.bodyAngle);
        dz = Math.sin(tank.bodyAngle);
      }
      tank.dashVx = dx * DASH_SPEED;
      tank.dashVz = dz * DASH_SPEED;
      tank.dashTimer = DASH_DURATION;
      tank.dashCd = DASH_COOLDOWN;
      this.emitEvent('tank_dash', { player: playerIndex, x: tank.x, z: tank.z });
    }
  }

  _spawnPowerup(x, z) {
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    this.powerups.push({
      id: `pu_${this.nextId++}`,
      type,
      x,
      z,
      ttl: 14,
    });
  }

  _fireBullet(tank) {
    const activeOwned = this.bullets.filter((b) => b.owner === tank.index).length;
    if (activeOwned >= 5) return;

    const angles =
      tank.tripleAmmo > 0
        ? [tank.turretAngle - 0.18, tank.turretAngle, tank.turretAngle + 0.18]
        : [tank.turretAngle];

    if (tank.tripleAmmo > 0) tank.tripleAmmo -= 1;

    const muzzleDist = TANK_RADIUS + BULLET_RADIUS + 0.28;
    for (const ang of angles) {
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      this.bullets.push({
        id: `b_${this.nextId++}`,
        owner: tank.index,
        x: tank.x + cos * muzzleDist,
        z: tank.z + sin * muzzleDist,
        vx: cos * BULLET_SPEED,
        vz: sin * BULLET_SPEED,
        bouncesLeft: MAX_BOUNCES,
        age: 0,
      });
    }

    tank.fireCd = tank.rapidTimer > 0 ? FIRE_COOLDOWN * 0.45 : FIRE_COOLDOWN;
    this.emitEvent('tank_fire', {
      player: tank.index,
      x: tank.x + Math.cos(tank.turretAngle) * muzzleDist,
      z: tank.z + Math.sin(tank.turretAngle) * muzzleDist,
      angle: tank.turretAngle,
    });
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

    // Periodic center powerup spawn
    this.powerupTimer -= dt;
    if (this.powerupTimer <= 0 && this.powerups.length < 3) {
      this.powerupTimer = 7.5;
      const spotZ = (Math.random() > 0.5 ? 1 : -1) * (1.8 + Math.random() * 5.2);
      this._spawnPowerup((Math.random() - 0.5) * 3.0, spotZ);
    }

    // Update tanks
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      tank.fireCd = Math.max(0, tank.fireCd - dt);
      tank.dashCd = Math.max(0, tank.dashCd - dt);
      tank.rapidTimer = Math.max(0, tank.rapidTimer - dt);
      tank.speedTimer = Math.max(0, tank.speedTimer - dt);
      tank.hitFlash = Math.max(0, tank.hitFlash - dt);

      const inp = this.inputs[tank.index] || {};
      if (Number.isFinite(inp.aimX) && Number.isFinite(inp.aimZ)) {
        tank.turretAngle = Math.atan2(inp.aimZ - tank.z, inp.aimX - tank.x);
      }

      if (tank.dashTimer > 0) {
        tank.dashTimer -= dt;
        tank.x += tank.dashVx * dt;
        tank.z += tank.dashVz * dt;
      } else {
        let mx = clamp(Number(inp.moveX) || 0, -1, 1);
        let mz = clamp(Number(inp.moveZ) || 0, -1, 1);
        const len = Math.hypot(mx, mz);
        if (len > 1) {
          mx /= len;
          mz /= len;
        }
        const spd = tank.speedTimer > 0 ? TANK_SPEED * 1.4 : TANK_SPEED;
        if (len > 0.05) {
          tank.x += mx * spd * dt;
          tank.z += mz * spd * dt;
          tank.bodyAngle = Math.atan2(mz, mx);
        }
      }

      // Clamp to arena bounds
      tank.x = clamp(tank.x, -HALF_W + TANK_RADIUS, HALF_W - TANK_RADIUS);
      tank.z = clamp(tank.z, -HALF_H + TANK_RADIUS, HALF_H - TANK_RADIUS);

      // Resolve tank vs obstacles
      for (const obs of this.obstacles) {
        const res = resolveCircleAABB(tank.x, tank.z, TANK_RADIUS, obs);
        if (res.hit) {
          tank.x = res.x;
          tank.z = res.z;
        }
      }

      if (inp.fire && tank.fireCd <= 0) {
        this._fireBullet(tank);
      }
    }

    // Tank vs Tank separation
    const t0 = this.tanks[0];
    const t1 = this.tanks[1];
    if (t0.alive && t1.alive) {
      const dx = t1.x - t0.x;
      const dz = t1.z - t0.z;
      const minDist = TANK_RADIUS * 2;
      const d2 = dx * dx + dz * dz;
      if (d2 > 0 && d2 < minDist * minDist) {
        const d = Math.sqrt(d2);
        const push = (minDist - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        t0.x = clamp(t0.x - nx * push, -HALF_W + TANK_RADIUS, HALF_W - TANK_RADIUS);
        t0.z = clamp(t0.z - nz * push, -HALF_H + TANK_RADIUS, HALF_H - TANK_RADIUS);
        t1.x = clamp(t1.x + nx * push, -HALF_W + TANK_RADIUS, HALF_W - TANK_RADIUS);
        t1.z = clamp(t1.z + nz * push, -HALF_H + TANK_RADIUS, HALF_H - TANK_RADIUS);
      }
    }

    // Collect powerups
    this.powerups = this.powerups.filter((pu) => {
      pu.ttl -= dt;
      if (pu.ttl <= 0) return false;
      for (const tank of this.tanks) {
        if (!tank.alive) continue;
        if (distSq(tank.x, tank.z, pu.x, pu.z) <= (TANK_RADIUS + 0.65) ** 2) {
          if (pu.type === 'shield') tank.shield = true;
          else if (pu.type === 'triple') tank.tripleAmmo = 3;
          else if (pu.type === 'rapid') tank.rapidTimer = 5.5;
          else if (pu.type === 'speed') tank.speedTimer = 5.5;
          this.emitEvent('powerup_pickup', { player: tank.index, kind: pu.type, x: pu.x, z: pu.z });
          return false;
        }
      }
      return true;
    });

    // Sub-step bullets for crisp ricochet & zero tunneling
    const subSteps = 3;
    const subDt = dt / subSteps;
    const survivingBullets = [];

    for (const b of this.bullets) {
      let alive = true;
      for (let s = 0; s < subSteps && alive; s++) {
        b.age += subDt;
        b.x += b.vx * subDt;
        b.z += b.vz * subDt;

        // Arena wall bounce
        let bounced = false;
        if (b.x - BULLET_RADIUS <= -HALF_W) {
          b.x = -HALF_W + BULLET_RADIUS;
          b.vx = Math.abs(b.vx);
          bounced = true;
        } else if (b.x + BULLET_RADIUS >= HALF_W) {
          b.x = HALF_W - BULLET_RADIUS;
          b.vx = -Math.abs(b.vx);
          bounced = true;
        }
        if (b.z - BULLET_RADIUS <= -HALF_H) {
          b.z = -HALF_H + BULLET_RADIUS;
          b.vz = Math.abs(b.vz);
          bounced = true;
        } else if (b.z + BULLET_RADIUS >= HALF_H) {
          b.z = HALF_H - BULLET_RADIUS;
          b.vz = -Math.abs(b.vz);
          bounced = true;
        }

        if (bounced) {
          if (b.bouncesLeft > 0) {
            b.bouncesLeft -= 1;
            this.emitEvent('ricochet', { x: b.x, z: b.z });
          } else {
            alive = false;
            this.emitEvent('bullet_spark', { x: b.x, z: b.z });
            break;
          }
        }

        // Obstacle bounce / crate destruction
        for (let i = 0; i < this.obstacles.length; i++) {
          const obs = this.obstacles[i];
          const res = resolveCircleAABB(b.x, b.z, BULLET_RADIUS, obs);
          if (!res.hit) continue;

          if (obs.destructible) {
            obs.hp -= 1;
            alive = false;
            this.emitEvent('crate_hit', { x: obs.x, z: obs.z, destroyed: obs.hp <= 0 });
            if (obs.hp <= 0) {
              this.obstacles.splice(i, 1);
              if (Math.random() < 0.55) {
                this._spawnPowerup(obs.x, obs.z);
              }
            }
            break;
          } else {
            b.x = res.x;
            b.z = res.z;
            const refl = reflectVelocity(b.vx, b.vz, res.nx, res.nz);
            b.vx = refl.vx;
            b.vz = refl.vz;
            if (b.bouncesLeft > 0) {
              b.bouncesLeft -= 1;
              this.emitEvent('ricochet', { x: b.x, z: b.z });
            } else {
              alive = false;
              this.emitEvent('bullet_spark', { x: b.x, z: b.z });
            }
            break;
          }
        }

        if (!alive) break;

        // Tank hit check
        for (const tank of this.tanks) {
          if (!tank.alive) continue;
          if (tank.index === b.owner && b.age < 0.18) continue;
          if (distSq(b.x, b.z, tank.x, tank.z) <= (TANK_RADIUS + BULLET_RADIUS) ** 2) {
            alive = false;
            if (tank.shield) {
              tank.shield = false;
              this.emitEvent('shield_break', { player: tank.index, x: tank.x, z: tank.z });
            } else {
              tank.hp -= 1;
              tank.hitFlash = 0.25;
              this.emitEvent('tank_hit', { player: tank.index, x: tank.x, z: tank.z, hp: tank.hp });
              if (tank.hp <= 0) {
                tank.alive = false;
                this._handleTankDestroyed(tank.index);
              }
            }
            break;
          }
        }
      }
      if (alive) survivingBullets.push(b);
    }

    this.bullets = survivingBullets;
  }

  _handleTankDestroyed(loserIndex) {
    const winnerIndex = loserIndex === 0 ? 1 : 0;
    this.scores[winnerIndex] += 1;
    this.roundWinner = winnerIndex;
    const loser = this.tanks[loserIndex];
    this.emitEvent('tank_explode', { player: loserIndex, x: loser.x, z: loser.z });

    if (this.scores[winnerIndex] >= WIN_ROUNDS) {
      this.result = {
        winner: winnerIndex,
        reason: `Player ${winnerIndex + 1} dominated the Tank Arena ${this.scores[0]}–${this.scores[1]}`,
        scores: [...this.scores],
      };
    } else {
      this.roundPause = 2.2;
    }
  }

  computeBotInput(botIndex) {
    const me = this.tanks[botIndex];
    const enemy = this.tanks[botIndex === 0 ? 1 : 0];
    if (!me || !me.alive || !enemy || !enemy.alive) return {};
    const dx = enemy.x - me.x;
    const dz = enemy.z - me.z;
    const dist = Math.hypot(dx, dz) || 1;
    const strafe = Math.sin(this.elapsed * 2.1);
    const nx = dx / dist;
    const nz = dz / dist;
    const moveX = (dist > 7 ? nx * 0.6 : -nx * 0.4) - nz * strafe * 0.8;
    const moveZ = (dist > 7 ? nz * 0.6 : -nz * 0.4) + nx * strafe * 0.8;
    return {
      moveX,
      moveZ,
      aimX: enemy.x + Math.sin(this.elapsed * 3) * 0.6,
      aimZ: enemy.z + Math.cos(this.elapsed * 2.4) * 0.6,
      fire: me.fireCd <= 0 && dist < 24,
      dash: me.dashCd <= 0 && Math.random() < 0.015,
    };
  }

  getState() {
    return {
      gameId: this.id,
      arena: { w: ARENA_W, h: ARENA_H },
      round: this.round,
      winRounds: WIN_ROUNDS,
      scores: this.scores,
      roundWinner: this.roundWinner,
      roundPause: this.roundPause,
      tanks: this.tanks.map((t) => ({
        index: t.index,
        x: t.x,
        z: t.z,
        bodyAngle: t.bodyAngle,
        turretAngle: t.turretAngle,
        hp: t.hp,
        maxHp: t.maxHp,
        shield: t.shield,
        tripleAmmo: t.tripleAmmo,
        rapid: t.rapidTimer > 0,
        speed: t.speedTimer > 0,
        dashReady: t.dashCd <= 0,
        alive: t.alive,
        hitFlash: t.hitFlash > 0,
      })),
      obstacles: this.obstacles,
      bullets: this.bullets.map((b) => ({
        id: b.id,
        owner: b.owner,
        x: b.x,
        z: b.z,
        vx: b.vx,
        vz: b.vz,
      })),
      powerups: this.powerups,
    };
  }
}
