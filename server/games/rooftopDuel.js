import { BaseGame } from './BaseGame.js';
import { clamp, distSq } from './math.js';

const ARENA_HALF_X = 14.5;
const DEATH_Y = -4.2;
const GRAVITY = -28;
const MOVE_SPD = 9.2;
const JUMP_VY = 13.0;
const DASH_SPD = 19.5;
const WIN_ROUNDS = 3;

const PLATFORMS = [
  { id: 'main', minX: -12.0, maxX: 12.0, y: 0, solid: true },
  { id: 'left_mid', minX: -10.5, maxX: -4.2, y: 3.1, solid: false },
  { id: 'right_mid', minX: 4.2, maxX: 10.5, y: 3.1, solid: false },
  { id: 'top_bridge', minX: -3.6, maxX: 3.6, y: 6.1, solid: false },
];

const WEAPON_SPECS = {
  pistol: { name: 'Pulse Pistol', dmg: 14, cd: 0.34, speed: 22, ammo: Infinity },
  laser: { name: 'Laser Rifle', dmg: 25, cd: 0.45, speed: 32, ammo: 6 },
  rocket: { name: 'Rocket Launcher', dmg: 34, cd: 0.78, speed: 15.5, ammo: 3 },
  blade: { name: 'Plasma Blade', dmg: 36, cd: 0.48, speed: 0, ammo: 5 },
  grenade: { name: 'Cluster Grenade', dmg: 38, cd: 0.65, speed: 13.5, ammo: 3 },
};

const DROP_WEAPONS = ['laser', 'rocket', 'blade', 'grenade'];

export class RooftopDuelGame extends BaseGame {
  constructor() {
    super('rooftop_duel');
    this.scores = [0, 0];
    this.round = 1;
    this.roundPause = 0;
    this.roundWinner = null;
    this.nextId = 1;
    this.crateTimer = 4.5;
    this.fighters = [];
    this.projectiles = [];
    this.crates = [];
    this._setupRound();
  }

  _setupRound() {
    this.roundPause = 0;
    this.roundWinner = null;
    this.projectiles = [];
    this.crates = [];
    this.crateTimer = 4.0;
    this.fighters = [
      this._makeFighter(0, -7.5, 0.2, 1),
      this._makeFighter(1, 7.5, 0.2, -1),
    ];
  }

  _makeFighter(index, x, y, facing) {
    return {
      index,
      x,
      y,
      vx: 0,
      vy: 0,
      facing,
      hp: 100,
      maxHp: 100,
      grounded: false,
      jumpsLeft: 2,
      weapon: 'pistol',
      ammo: Infinity,
      fireCd: 0,
      dashCd: 0,
      dashTimer: 0,
      hitFlash: 0,
      slashTimer: 0,
      prevJumpPressed: false,
      alive: true,
    };
  }

  onPlayerInput(playerIndex, input) {
    if (playerIndex !== 0 && playerIndex !== 1) return;
    super.onPlayerInput(playerIndex, input);
    const f = this.fighters[playerIndex];
    if (!f || !f.alive || this.roundPause > 0 || this.result) return;

    if (input.dash && f.dashCd <= 0 && f.dashTimer <= 0) {
      const dir = (Number(input.moveX) || 0) !== 0 ? Math.sign(Number(input.moveX)) : f.facing;
      f.facing = dir;
      f.vx = dir * DASH_SPD;
      f.vy = Math.max(f.vy, 1.5);
      f.dashTimer = 0.15;
      f.dashCd = 1.6;
      this.emitEvent('fighter_dash', { player: playerIndex, x: f.x, y: f.y });
    }
  }

  _attack(f) {
    const spec = WEAPON_SPECS[f.weapon] || WEAPON_SPECS.pistol;
    f.fireCd = spec.cd;

    if (f.weapon === 'blade') {
      f.slashTimer = 0.22;
      const other = this.fighters[f.index === 0 ? 1 : 0];
      if (other.alive) {
        const dx = other.x - f.x;
        const dy = (other.y + 0.8) - (f.y + 0.8);
        if (Math.sign(dx || f.facing) === f.facing && Math.abs(dx) <= 2.75 && Math.abs(dy) <= 1.7) {
          this._damageFighter(other, spec.dmg, f.facing * 13, 6.5);
        }
      }
      this.emitEvent('blade_slash', { player: f.index, x: f.x, y: f.y + 0.9, facing: f.facing });
    } else {
      const aimX = Number.isFinite(this.inputs[f.index]?.aimX) ? this.inputs[f.index].aimX : f.x + f.facing * 5;
      const aimY = Number.isFinite(this.inputs[f.index]?.aimY) ? this.inputs[f.index].aimY : f.y + 0.95;
      let dx = aimX - f.x;
      let dy = aimY - (f.y + 0.95);
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      f.facing = dx >= 0 ? 1 : -1;

      this.projectiles.push({
        id: `rp_${this.nextId++}`,
        owner: f.index,
        kind: f.weapon,
        x: f.x + dx * 0.85,
        y: f.y + 0.95 + dy * 0.85,
        vx: dx * spec.speed,
        vy: dy * spec.speed + (f.weapon === 'grenade' ? 4.5 : 0),
        dmg: spec.dmg,
        ttl: f.weapon === 'grenade' ? 1.15 : 2.2,
      });
      this.emitEvent('rooftop_fire', { player: f.index, kind: f.weapon, x: f.x, y: f.y + 1.0 });
    }

    if (f.ammo !== Infinity) {
      f.ammo -= 1;
      if (f.ammo <= 0) {
        f.weapon = 'pistol';
        f.ammo = Infinity;
      }
    }
  }

  _damageFighter(target, dmg, kbX, kbY) {
    if (!target.alive) return;
    target.hp = Math.max(0, target.hp - dmg);
    target.vx += kbX;
    target.vy = Math.max(target.vy, kbY);
    target.hitFlash = 0.22;
    this.emitEvent('fighter_hit', { player: target.index, x: target.x, y: target.y + 0.9, dmg });
    if (target.hp <= 0) {
      this._koFighter(target.index);
    }
  }

  _explode(x, y, radius, dmg, owner) {
    this.emitEvent('rooftop_explosion', { x, y, radius });
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const dx = f.x - x;
      const dy = (f.y + 0.8) - y;
      const d = Math.hypot(dx, dy);
      if (d <= radius) {
        const falloff = 1 - (d / radius) * 0.45;
        const nx = d > 0.01 ? dx / d : (f.index === owner ? -1 : 1);
        this._damageFighter(f, Math.round(dmg * falloff), nx * 14 * falloff, 8.5 * falloff);
      }
    }
  }

  _koFighter(loserIndex) {
    const loser = this.fighters[loserIndex];
    if (!loser.alive) return;
    loser.alive = false;
    const winner = loserIndex === 0 ? 1 : 0;
    this.scores[winner] += 1;
    this.roundWinner = winner;
    this.emitEvent('fighter_ko', { player: loserIndex, x: loser.x, y: loser.y });

    if (this.scores[winner] >= WIN_ROUNDS) {
      this.result = {
        winner,
        reason: `Player ${winner + 1} won Rooftop Duel ${this.scores[0]}–${this.scores[1]}`,
        scores: [...this.scores],
      };
    } else {
      this.roundPause = 2.0;
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

    // Drop weapon crates
    this.crateTimer -= dt;
    if (this.crateTimer <= 0 && this.crates.length < 2) {
      this.crateTimer = 6.5;
      const kind = DROP_WEAPONS[Math.floor(Math.random() * DROP_WEAPONS.length)];
      this.crates.push({
        id: `wc_${this.nextId++}`,
        kind,
        x: (Math.random() - 0.5) * 18,
        y: 11.5,
        vy: -3.5,
      });
    }

    // Update crates
    for (const cr of this.crates) {
      cr.y += cr.vy * dt;
      for (const p of PLATFORMS) {
        if (cr.x >= p.minX && cr.x <= p.maxX && cr.y <= p.y + 0.45 && cr.y >= p.y - 0.5) {
          cr.y = p.y + 0.45;
          cr.vy = 0;
        }
      }
    }
    this.crates = this.crates.filter((cr) => cr.y > DEATH_Y);

    // Update fighters
    for (const f of this.fighters) {
      if (!f.alive) continue;
      f.fireCd = Math.max(0, f.fireCd - dt);
      f.dashCd = Math.max(0, f.dashCd - dt);
      f.hitFlash = Math.max(0, f.hitFlash - dt);
      f.slashTimer = Math.max(0, f.slashTimer - dt);

      const inp = this.inputs[f.index] || {};
      const mx = clamp(Number(inp.moveX) || 0, -1, 1);

      if (f.dashTimer > 0) {
        f.dashTimer -= dt;
      } else {
        const targetVx = mx * MOVE_SPD;
        f.vx += (targetVx - f.vx) * Math.min(1, dt * 14);
        if (Math.abs(mx) > 0.1) f.facing = mx > 0 ? 1 : -1;
      }

      const jumpPressed = Boolean(inp.jump);
      if (jumpPressed && !f.prevJumpPressed && f.jumpsLeft > 0) {
        f.vy = JUMP_VY;
        f.grounded = false;
        f.jumpsLeft -= 1;
        this.emitEvent('fighter_jump', { player: f.index, x: f.x, y: f.y });
      }
      f.prevJumpPressed = jumpPressed;

      const prevY = f.y;
      f.vy += GRAVITY * dt;
      f.x = clamp(f.x + f.vx * dt, -ARENA_HALF_X, ARENA_HALF_X);
      f.y += f.vy * dt;
      f.grounded = false;

      const dropDown = Boolean(inp.down);
      for (const p of PLATFORMS) {
        if (f.x >= p.minX - 0.35 && f.x <= p.maxX + 0.35) {
          if (f.vy <= 0 && prevY >= p.y - 0.08 && f.y <= p.y && (p.solid || !dropDown)) {
            f.y = p.y;
            f.vy = 0;
            f.grounded = true;
            f.jumpsLeft = 2;
            break;
          }
        }
      }

      if (f.y < DEATH_Y) {
        this._koFighter(f.index);
        continue;
      }

      // Pick up weapon crates
      this.crates = this.crates.filter((cr) => {
        if (distSq(f.x, f.y + 0.8, cr.x, cr.y) <= 1.35 * 1.35) {
          f.weapon = cr.kind;
          f.ammo = WEAPON_SPECS[cr.kind].ammo;
          this.emitEvent('powerup_pickup', { player: f.index, kind: cr.kind, x: cr.x, y: cr.y });
          return false;
        }
        return true;
      });

      if (inp.fire && f.fireCd <= 0) {
        this._attack(f);
      }
    }

    // Update projectiles
    const keepProj = [];
    for (const pr of this.projectiles) {
      pr.ttl -= dt;
      if (pr.ttl <= 0) {
        if (pr.kind === 'grenade') this._explode(pr.x, pr.y, 3.2, pr.dmg, pr.owner);
        continue;
      }

      if (pr.kind === 'grenade') pr.vy += GRAVITY * 0.65 * dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;

      if (Math.abs(pr.x) > ARENA_HALF_X + 2 || pr.y < DEATH_Y - 2) continue;

      if (pr.kind === 'grenade') {
        for (const p of PLATFORMS) {
          if (pr.x >= p.minX && pr.x <= p.maxX && pr.y <= p.y + 0.25 && pr.y >= p.y - 0.35 && pr.vy < 0) {
            pr.y = p.y + 0.25;
            pr.vy = Math.abs(pr.vy) * 0.62;
            pr.vx *= 0.85;
          }
        }
      }

      let hit = false;
      for (const f of this.fighters) {
        if (!f.alive || f.index === pr.owner) continue;
        if (Math.abs(pr.x - f.x) <= 0.65 && pr.y >= f.y && pr.y <= f.y + 1.85) {
          hit = true;
          if (pr.kind === 'rocket' || pr.kind === 'grenade') {
            this._explode(pr.x, pr.y, 3.1, pr.dmg, pr.owner);
          } else {
            this._damageFighter(f, pr.dmg, Math.sign(pr.vx || 1) * 7.5, 4.2);
          }
          break;
        }
      }
      if (!hit) keepProj.push(pr);
    }
    this.projectiles = keepProj;
  }

  computeBotInput(botIndex) {
    const me = this.fighters[botIndex];
    const enemy = this.fighters[botIndex === 0 ? 1 : 0];
    if (!me || !me.alive || !enemy || !enemy.alive) return {};
    const dx = enemy.x - me.x;
    const moveX = Math.abs(dx) > 4.2 ? Math.sign(dx) : Math.sin(this.elapsed * 2) * 0.6;
    const nearEdge = Math.abs(me.x) > 10.5;
    return {
      moveX: nearEdge ? -Math.sign(me.x) : moveX,
      jump: (me.y < -0.5 || (enemy.y > me.y + 2 && Math.random() < 0.05)),
      aimX: enemy.x,
      aimY: enemy.y + 0.9,
      fire: me.fireCd <= 0 && Math.abs(dx) < 16,
      dash: me.dashCd <= 0 && Math.random() < 0.01,
    };
  }

  getState() {
    return {
      gameId: this.id,
      platforms: PLATFORMS,
      scores: this.scores,
      round: this.round,
      winRounds: WIN_ROUNDS,
      roundWinner: this.roundWinner,
      roundPause: this.roundPause,
      fighters: this.fighters.map((f) => ({
        index: f.index,
        x: f.x,
        y: f.y,
        vx: f.vx,
        vy: f.vy,
        facing: f.facing,
        hp: f.hp,
        maxHp: f.maxHp,
        weapon: f.weapon,
        weaponName: WEAPON_SPECS[f.weapon]?.name || 'Pulse Pistol',
        ammo: f.ammo === Infinity ? '∞' : f.ammo,
        dashReady: f.dashCd <= 0,
        hitFlash: f.hitFlash > 0,
        slash: f.slashTimer > 0,
        alive: f.alive,
      })),
      projectiles: this.projectiles,
      crates: this.crates,
    };
  }
}
