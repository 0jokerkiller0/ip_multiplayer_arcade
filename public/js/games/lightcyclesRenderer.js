import * as THREE from 'three';
import { SFX } from '../engine/SoundFX.js';

const BIKE_COLORS = [0x00e5ff, 0xff3b7f];

function createBikeMesh(colorHex) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.85,
    roughness: 0.22,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 1.5,
    roughness: 0.2,
  });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 0.52), bodyMat);
  chassis.position.y = 0.35;
  chassis.castShadow = true;
  root.add(chassis);

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.25, 0.38), glowMat);
  canopy.position.set(0.15, 0.62, 0);
  root.add(canopy);

  const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.2, 16);
  const fWheel = new THREE.Mesh(wheelGeo, glowMat);
  fWheel.rotation.x = Math.PI * 0.5;
  fWheel.position.set(0.62, 0.28, 0);
  const bWheel = new THREE.Mesh(wheelGeo, glowMat);
  bWheel.rotation.x = Math.PI * 0.5;
  bWheel.position.set(-0.62, 0.28, 0);
  root.add(fWheel, bWheel);

  const light = new THREE.PointLight(colorHex, 8, 7, 1.8);
  light.position.set(0, 0.9, 0);
  root.add(light);

  root.userData = { canopy, glowMat };
  return root;
}

export class LightcyclesRenderer {
  constructor(sceneMgr) {
    this.sm = sceneMgr;
    this.group = new THREE.Group();
    this.bikes = [];
    this.trailGroup = new THREE.Group();
    this.pickupMeshes = new Map();
    this.perimeterWalls = [];
  }

  mount() {
    this.sm.clearWorld();
    this.sm.worldGroup.add(this.group);
    this.sm.setCamera(new THREE.Vector3(0, 27, 20), new THREE.Vector3(0, 0, 1), 48);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 26),
      new THREE.MeshStandardMaterial({
        map: this.sm.textures.neonGrid,
        roughness: 0.35,
        metalness: 0.6,
      })
    );
    floor.rotation.x = -Math.PI * 0.5;
    floor.receiveShadow = true;
    this.group.add(floor);

    // 4 dynamic laser boundary walls
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.65 });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.85, 0.22), wallMat.clone());
      this.group.add(m);
      this.perimeterWalls.push(m);
    }

    this.group.add(this.trailGroup);
    this.bikes = [createBikeMesh(BIKE_COLORS[0]), createBikeMesh(BIKE_COLORS[1])];
    this.group.add(this.bikes[0], this.bikes[1]);
  }

  sampleInput(inputMgr) {
    let turn = null;
    if (inputMgr.consumePress('KeyW') || inputMgr.consumePress('ArrowUp')) turn = 'up';
    else if (inputMgr.consumePress('KeyS') || inputMgr.consumePress('ArrowDown')) turn = 'down';
    else if (inputMgr.consumePress('KeyA') || inputMgr.consumePress('ArrowLeft')) turn = 'left';
    else if (inputMgr.consumePress('KeyD') || inputMgr.consumePress('ArrowRight')) turn = 'right';

    return {
      turn,
      boost: inputMgr.isDown('Space') || inputMgr.isDown('ShiftLeft'),
    };
  }

  handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'bike_turn') {
        SFX.play('click');
      } else if (ev.type === 'bike_crash') {
        SFX.play('explosion');
        this.sm.addShake(0.85);
        this.sm.vfx.burst(ev.x, 0.5, ev.z, BIKE_COLORS[ev.player], 32, 11, 0.65);
        this.sm.vfx.shockwave(ev.x, 0.1, ev.z, BIKE_COLORS[ev.player], 5.5, 0.45);
      } else if (ev.type === 'powerup_pickup') {
        SFX.play('powerup');
        this.sm.vfx.shockwave(ev.x, 0.2, ev.z, 0x34d399, 3, 0.35);
      }
    }
  }

  update(state, dt) {
    if (!state) return;
    const { halfW, halfH } = state.arena;

    // Update shrinking perimeter walls
    const [top, bot, left, right] = this.perimeterWalls;
    const wallColor = state.shrinking ? 0xf43f5e : 0x38bdf8;
    for (const w of this.perimeterWalls) w.material.color.setHex(wallColor);

    top.scale.set(halfW * 2, 1, 1);
    top.position.set(0, 0.42, -halfH);
    bot.scale.set(halfW * 2, 1, 1);
    bot.position.set(0, 0.42, halfH);
    left.scale.set(halfH * 2, 1, 1);
    left.rotation.y = Math.PI * 0.5;
    left.position.set(-halfW, 0.42, 0);
    right.scale.set(halfH * 2, 1, 1);
    right.rotation.y = Math.PI * 0.5;
    right.position.set(halfW, 0.42, 0);

    // Rebuild ribbon trails cleanly
    while (this.trailGroup.children.length > 0) {
      this.trailGroup.remove(this.trailGroup.children[0]);
    }

    for (const b of state.bikes) {
      const mesh = this.bikes[b.index];
      mesh.visible = b.alive;
      mesh.position.set(b.x, 0, b.z);
      mesh.rotation.y = -b.angle;
      mesh.userData.glowMat.opacity = b.phase ? 0.45 : 1;
      mesh.userData.glowMat.transparent = b.phase;

      const pts = b.trail;
      const trailMat = new THREE.MeshStandardMaterial({
        color: BIKE_COLORS[b.index],
        emissive: BIKE_COLORS[b.index],
        emissiveIntensity: 1.15,
        transparent: true,
        opacity: b.phase ? 0.4 : 0.88,
      });

      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.02) continue;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.52, 0.14), trailMat);
        seg.position.set((p1.x + p2.x) * 0.5, 0.28, (p1.z + p2.z) * 0.5);
        seg.rotation.y = -Math.atan2(dz, dx);
        this.trailGroup.add(seg);
      }
    }

    // Pickups
    const seen = new Set();
    for (const pu of state.pickups) {
      seen.add(pu.id);
      let m = this.pickupMeshes.get(pu.id);
      if (!m) {
        const col = pu.kind === 'phase' ? 0xa855f7 : 0x34d399;
        m = new THREE.Mesh(
          new THREE.TorusGeometry(0.42, 0.12, 10, 20),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9 })
        );
        m.position.set(pu.x, 0.65, pu.z);
        this.group.add(m);
        this.pickupMeshes.set(pu.id, m);
      }
      m.rotation.y += dt * 3;
      m.rotation.x += dt * 1.5;
    }
    for (const [id, m] of this.pickupMeshes) {
      if (!seen.has(id)) {
        this.group.remove(m);
        this.pickupMeshes.delete(id);
      }
    }
  }

  getHudSummary(state, names) {
    if (!state) return { p1: 0, p2: 0, sub: '', bars: [] };
    return {
      p1: state.scores[0],
      p2: state.scores[1],
      sub: `ROUND ${state.round}${state.shrinking ? ' • ARENA SHRINKING!' : ''}`,
      bars: state.bikes.map((b, i) => ({
        label: `${names[i]} BOOST: ${b.boostEnergy}%${b.phase ? ' [PHASE]' : ''}`,
        pct: b.boostEnergy,
        color: i === 0 ? '#00e5ff' : '#ff3b7f',
      })),
    };
  }

  unmount() {
    this.pickupMeshes.clear();
    this.perimeterWalls = [];
  }
}
