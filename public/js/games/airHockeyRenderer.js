import * as THREE from 'three';
import { SFX } from '../engine/SoundFX.js';

const PADDLE_COLORS = [0x00e5ff, 0xff5a36];

function createPaddleMesh(colorHex) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.88, 0.92, 0.26, 28),
    new THREE.MeshStandardMaterial({
      color: colorHex,
      metalness: 0.55,
      roughness: 0.25,
      emissive: colorHex,
      emissiveIntensity: 0.22,
    })
  );
  base.position.y = 0.14;
  base.castShadow = true;

  const knob = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.36, 0.42, 20),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.7, roughness: 0.3 })
  );
  knob.position.y = 0.38;
  knob.castShadow = true;

  g.add(base, knob);
  return g;
}

export class AirHockeyRenderer {
  constructor(sceneMgr) {
    this.sm = sceneMgr;
    this.group = new THREE.Group();
    this.paddles = [];
    this.puckMeshes = new Map();
    this.modMeshes = new Map();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.15);
    this.raycaster = new THREE.Raycaster();
    this.hitPoint = new THREE.Vector3();
  }

  mount(localPlayerIndex) {
    this.sm.clearWorld();
    this.sm.worldGroup.add(this.group);

    // Orient camera behind local player's side!
    const zSign = localPlayerIndex === 1 ? 1 : -1;
    this.sm.setCamera(new THREE.Vector3(0, 17.5, zSign * 17.5), new THREE.Vector3(0, 0, 0), 46);

    // Table surface
    const surface = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.4, 20),
      new THREE.MeshStandardMaterial({
        map: this.sm.textures.rink,
        roughness: 0.18,
        metalness: 0.1,
      })
    );
    surface.position.y = -0.2;
    surface.receiveShadow = true;
    this.group.add(surface);

    // Brushed aluminum side rails
    const railMat = new THREE.MeshStandardMaterial({
      map: this.sm.textures.steel,
      color: 0x64748b,
      metalness: 0.85,
      roughness: 0.25,
    });
    const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.85, 21.2), railMat);
    leftRail.position.set(-6.3, 0.22, 0);
    leftRail.castShadow = true;
    const rightRail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.85, 21.2), railMat);
    rightRail.position.set(6.3, 0.22, 0);
    rightRail.castShadow = true;
    this.group.add(leftRail, rightRail);

    // End rails around goals (goal width = 4.5, total = 12 -> 3.75 each wing)
    for (const zPos of [-10.3, 10.3]) {
      for (const xPos of [-4.125, 4.125]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(3.75, 0.85, 0.6), railMat);
        wing.position.set(xPos, 0.22, zPos);
        wing.castShadow = true;
        this.group.add(wing);
      }
      // Glowing goal strip
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(4.5, 0.08, 0.25),
        new THREE.MeshBasicMaterial({ color: zPos < 0 ? PADDLE_COLORS[0] : PADDLE_COLORS[1] })
      );
      strip.position.set(0, 0.05, zPos < 0 ? -10.05 : 10.05);
      this.group.add(strip);
    }

    this.paddles = [createPaddleMesh(PADDLE_COLORS[0]), createPaddleMesh(PADDLE_COLORS[1])];
    this.group.add(this.paddles[0], this.paddles[1]);
  }

  sampleInput(inputMgr) {
    this.raycaster.setFromCamera(inputMgr.mouseNdc, this.sm.camera);
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.hitPoint);

    const mx = (inputMgr.isDown('KeyD') || inputMgr.isDown('ArrowRight') ? 1 : 0) -
               (inputMgr.isDown('KeyA') || inputMgr.isDown('ArrowLeft') ? 1 : 0);
    const mz = (inputMgr.isDown('KeyS') || inputMgr.isDown('ArrowDown') ? 1 : 0) -
               (inputMgr.isDown('KeyW') || inputMgr.isDown('ArrowUp') ? 1 : 0);

    if (mx !== 0 || mz !== 0) {
      return { moveX: mx, moveZ: mz };
    }
    if (hit) {
      return { targetX: this.hitPoint.x, targetZ: this.hitPoint.z };
    }
    return {};
  }

  handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'paddle_hit' || ev.type === 'wall_clack') {
        SFX.play('clack');
        this.sm.vfx.burst(ev.x, 0.2, ev.z, 0xfbbf24, 5, 4, 0.18);
      } else if (ev.type === 'goal_scored') {
        SFX.play('goal');
        this.sm.addShake(0.7);
        this.sm.vfx.shockwave(0, 0.1, ev.scorer === 0 ? 10 : -10, PADDLE_COLORS[ev.scorer], 6, 0.5);
      } else if (ev.type === 'powerup_pickup') {
        SFX.play('powerup');
        this.sm.vfx.shockwave(ev.x, 0.2, ev.z, 0x34d399, 3, 0.35);
      }
    }
  }

  update(state, dt) {
    if (!state) return;

    for (const p of state.paddles) {
      const m = this.paddles[p.index];
      m.position.x += (p.x - m.position.x) * Math.min(1, dt * 28);
      m.position.z += (p.z - m.position.z) * Math.min(1, dt * 28);
      const scale = p.radius / 0.88;
      m.scale.set(scale, 1, scale);
    }

    const seenPucks = new Set();
    for (const pk of state.pucks) {
      seenPucks.add(pk.id);
      let m = this.puckMeshes.get(pk.id);
      if (!m) {
        const col = pk.golden ? 0xfbbf24 : 0x111827;
        m = new THREE.Mesh(
          new THREE.CylinderGeometry(pk.radius, pk.radius, 0.18, 24),
          new THREE.MeshStandardMaterial({
            color: col,
            emissive: pk.golden ? 0xf59e0b : 0xef4444,
            emissiveIntensity: pk.golden ? 0.8 : 0.45,
            metalness: 0.5,
            roughness: 0.25,
          })
        );
        m.castShadow = true;
        this.group.add(m);
        this.puckMeshes.set(pk.id, m);
      }
      m.position.set(pk.x, 0.1, pk.z);
    }
    for (const [id, m] of this.puckMeshes) {
      if (!seenPucks.has(id)) {
        this.group.remove(m);
        this.puckMeshes.delete(id);
      }
    }

    const seenMods = new Set();
    for (const mod of state.modifiers) {
      seenMods.add(mod.id);
      let m = this.modMeshes.get(mod.id);
      if (!m) {
        m = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.5, 0),
          new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: 0.85 })
        );
        m.position.set(mod.x, 0.65, mod.z);
        this.group.add(m);
        this.modMeshes.set(mod.id, m);
      }
      m.rotation.y += dt * 3;
    }
    for (const [id, m] of this.modMeshes) {
      if (!seenMods.has(id)) {
        this.group.remove(m);
        this.modMeshes.delete(id);
      }
    }
  }

  getHudSummary(state, names) {
    if (!state) return { p1: 0, p2: 0, sub: '', bars: [] };
    return {
      p1: state.scores[0],
      p2: state.scores[1],
      sub: `FIRST TO ${state.winGoals} GOALS`,
      bars: [
        { label: `${names[0]} (Blue Side)`, pct: (state.scores[0] / state.winGoals) * 100, color: '#00e5ff' },
        { label: `${names[1]} (Coral Side)`, pct: (state.scores[1] / state.winGoals) * 100, color: '#ff5a36' },
      ],
    };
  }

  unmount() {
    this.puckMeshes.clear();
    this.modMeshes.clear();
  }
}
