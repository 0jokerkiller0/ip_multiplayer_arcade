import * as THREE from 'three';
import { SFX } from '../engine/SoundFX.js';

const F_COLORS = [0x00e5ff, 0xa855f7];

function createFighterMesh(colorHex) {
  const g = new THREE.Group();
  const suitMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.65,
    roughness: 0.3,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 1.1,
    roughness: 0.25,
  });

  // Legs
  const legGeo = new THREE.BoxGeometry(0.24, 0.72, 0.28);
  const legL = new THREE.Mesh(legGeo, suitMat);
  legL.position.set(-0.14, 0.36, 0);
  legL.castShadow = true;
  const legR = new THREE.Mesh(legGeo, suitMat);
  legR.position.set(0.14, 0.36, 0);
  legR.castShadow = true;

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.76, 0.38), suitMat);
  torso.position.y = 1.05;
  torso.castShadow = true;

  // Chest core
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.42), glowMat);
  core.position.y = 1.12;

  // Head + glowing visor
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), suitMat);
  head.position.y = 1.68;
  head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.44), glowMat);
  visor.position.set(0.08, 1.7, 0);

  // Weapon arm
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.16, 0.16), glowMat);
  weapon.position.set(0.48, 1.08, 0.14);

  // Slash arc
  const slashArc = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.9, 16, 1, -0.9, 1.8),
    new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
  );
  slashArc.position.set(0.85, 1.05, 0);
  slashArc.visible = false;

  g.add(legL, legR, torso, core, head, visor, weapon, slashArc);
  g.userData = { legL, legR, suitMat, slashArc, weapon };
  return g;
}

export class RooftopDuelRenderer {
  constructor(sceneMgr) {
    this.sm = sceneMgr;
    this.group = new THREE.Group();
    this.fighters = [];
    this.projMeshes = new Map();
    this.crateMeshes = new Map();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.raycaster = new THREE.Raycaster();
    this.aimPoint = new THREE.Vector3();
  }

  mount() {
    this.sm.clearWorld();
    this.sm.worldGroup.add(this.group);
    this.sm.setCamera(new THREE.Vector3(0, 5.8, 22.5), new THREE.Vector3(0, 3.2, 0), 46);

    // Background cyberpunk skyline towers
    const bldgMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.5, roughness: 0.6 });
    const winColors = [0x00e5ff, 0xa855f7, 0xf59e0b, 0x38bdf8];
    for (let i = -5; i <= 5; i++) {
      if (i === 0) continue;
      const h = 14 + Math.abs(i * 2.3);
      const w = 3.6 + (Math.abs(i) % 2) * 1.4;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 3.5), bldgMat);
      b.position.set(i * 5.2, h * 0.5 - 12, -10 - (Math.abs(i) % 3) * 3);
      this.group.add(b);

      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.6, 0.35, 0.15),
        new THREE.MeshBasicMaterial({ color: winColors[Math.abs(i) % winColors.length] })
      );
      sign.position.set(b.position.x, b.position.y + h * 0.3, b.position.z + 1.85);
      this.group.add(sign);
    }

    // Main rooftop & elevated steel catwalks
    const roofMat = new THREE.MeshStandardMaterial({
      map: this.sm.textures.concrete,
      color: 0x475569,
      roughness: 0.75,
      metalness: 0.25,
    });
    const catwalkMat = new THREE.MeshStandardMaterial({
      map: this.sm.textures.steel,
      color: 0x64748b,
      roughness: 0.35,
      metalness: 0.8,
    });

    const mainRoof = new THREE.Mesh(new THREE.BoxGeometry(24, 6, 5.2), roofMat);
    mainRoof.position.set(0, -3.0, 0);
    mainRoof.receiveShadow = true;
    this.group.add(mainRoof);

    const plats = [
      { w: 6.3, x: -7.35, y: 3.1 },
      { w: 6.3, x: 7.35, y: 3.1 },
      { w: 7.2, x: 0, y: 6.1 },
    ];
    for (const p of plats) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.35, 3.0), catwalkMat);
      m.position.set(p.x, p.y - 0.175, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);

      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(p.w, 0.06, 0.08),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
      );
      strip.position.set(p.x, p.y - 0.15, 1.52);
      this.group.add(strip);
    }

    this.fighters = [createFighterMesh(F_COLORS[0]), createFighterMesh(F_COLORS[1])];
    this.group.add(this.fighters[0], this.fighters[1]);
  }

  sampleInput(inputMgr) {
    const mx = (inputMgr.isDown('KeyD') || inputMgr.isDown('ArrowRight') ? 1 : 0) -
               (inputMgr.isDown('KeyA') || inputMgr.isDown('ArrowLeft') ? 1 : 0);
    const jump = inputMgr.isDown('KeyW') || inputMgr.isDown('ArrowUp') || inputMgr.isDown('Space');
    const down = inputMgr.isDown('KeyS') || inputMgr.isDown('ArrowDown');

    this.raycaster.setFromCamera(inputMgr.mouseNdc, this.sm.camera);
    this.raycaster.ray.intersectPlane(this.aimPlane, this.aimPoint);

    return {
      moveX: mx,
      jump,
      down,
      aimX: this.aimPoint.x,
      aimY: this.aimPoint.y,
      fire: inputMgr.mouseDown || inputMgr.isDown('KeyF') || inputMgr.isDown('Enter'),
      dash: inputMgr.consumePress('ShiftLeft') || inputMgr.consumePress('ShiftRight'),
    };
  }

  handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'rooftop_fire') {
        SFX.play(ev.kind === 'laser' ? 'laser' : 'tank_fire');
      } else if (ev.type === 'blade_slash') {
        SFX.play('slash');
      } else if (ev.type === 'rooftop_explosion') {
        SFX.play('explosion');
        this.sm.addShake(0.65);
        this.sm.vfx.burst(ev.x, ev.y, 0, 0xff6600, 28, 10, 0.55);
        this.sm.vfx.shockwave(ev.x, ev.y, 0, 0xffaa00, 4.5, 0.35);
      } else if (ev.type === 'fighter_hit') {
        SFX.play('clack');
        this.sm.addShake(0.28);
        this.sm.vfx.burst(ev.x, ev.y, 0, 0xf43f5e, 10, 6, 0.3);
      } else if (ev.type === 'fighter_ko') {
        SFX.play('explosion');
        this.sm.addShake(0.85);
        this.sm.vfx.burst(ev.x, ev.y + 0.8, 0, F_COLORS[ev.player], 30, 11, 0.7);
      } else if (ev.type === 'powerup_pickup') {
        SFX.play('powerup');
      }
    }
  }

  update(state, dt) {
    if (!state) return;

    for (const f of state.fighters) {
      const m = this.fighters[f.index];
      m.visible = f.alive;
      m.position.x += (f.x - m.position.x) * Math.min(1, dt * 26);
      m.position.y += (f.y - m.position.y) * Math.min(1, dt * 26);
      m.scale.x = f.facing;
      m.userData.slashArc.visible = f.slash;
      m.userData.suitMat.emissive.setHex(f.hitFlash ? 0xffffff : 0x000000);
      m.userData.suitMat.emissiveIntensity = f.hitFlash ? 0.8 : 0;

      // Leg run stride animation
      const run = Math.abs(f.vx) > 0.6 ? Math.sin(performance.now() * 0.02) * 0.45 : 0;
      m.userData.legL.rotation.z = run;
      m.userData.legR.rotation.z = -run;
    }

    const seenP = new Set();
    const projCol = { pistol: 0x38bdf8, laser: 0x22d3ee, rocket: 0xf97316, grenade: 0x84cc16 };
    for (const pr of state.projectiles) {
      seenP.add(pr.id);
      let m = this.projMeshes.get(pr.id);
      if (!m) {
        const geo = pr.kind === 'rocket' ? new THREE.BoxGeometry(0.48, 0.2, 0.2) : new THREE.SphereGeometry(0.18, 10, 10);
        m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: projCol[pr.kind] || 0xffffff }));
        this.group.add(m);
        this.projMeshes.set(pr.id, m);
      }
      m.position.set(pr.x, pr.y, 0);
      m.rotation.z = Math.atan2(pr.vy, pr.vx);
    }
    for (const [id, m] of this.projMeshes) {
      if (!seenP.has(id)) {
        this.group.remove(m);
        this.projMeshes.delete(id);
      }
    }

    const seenC = new Set();
    for (const cr of state.crates) {
      seenC.add(cr.id);
      let m = this.crateMeshes.get(cr.id);
      if (!m) {
        m = new THREE.Mesh(
          new THREE.BoxGeometry(0.85, 0.85, 0.85),
          new THREE.MeshStandardMaterial({
            map: this.sm.textures.crate,
            emissive: 0xfbbf24,
            emissiveIntensity: 0.28,
          })
        );
        m.castShadow = true;
        this.group.add(m);
        this.crateMeshes.set(cr.id, m);
      }
      m.position.set(cr.x, cr.y, 0);
      m.rotation.y += dt * 1.6;
    }
    for (const [id, m] of this.crateMeshes) {
      if (!seenC.has(id)) {
        this.group.remove(m);
        this.crateMeshes.delete(id);
      }
    }
  }

  getHudSummary(state, names) {
    if (!state) return { p1: 0, p2: 0, sub: '', bars: [] };
    return {
      p1: state.scores[0],
      p2: state.scores[1],
      sub: `ROUND ${state.round} • FIRST TO ${state.winRounds} KOs`,
      bars: state.fighters.map((f, i) => ({
        label: `${names[i]} HP: ${f.hp}% • ${f.weaponName} (${f.ammo})`,
        pct: f.hp,
        color: i === 0 ? '#00e5ff' : '#a855f7',
      })),
    };
  }

  unmount() {
    this.projMeshes.clear();
    this.crateMeshes.clear();
  }
}
