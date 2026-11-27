import * as THREE from 'three';
import { SFX } from '../engine/SoundFX.js';

const P_COLORS = [0x00e5ff, 0xff5a36];

function createTankMesh(colorHex, steelTex) {
  const root = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.65,
    roughness: 0.3,
    map: steelTex,
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.78,
    roughness: 0.42,
  });

  // Treads
  const treadGeo = new THREE.BoxGeometry(1.55, 0.34, 0.34);
  const leftTread = new THREE.Mesh(treadGeo, darkMetal);
  leftTread.position.set(0, 0.19, -0.62);
  leftTread.castShadow = true;
  const rightTread = new THREE.Mesh(treadGeo, darkMetal);
  rightTread.position.set(0, 0.19, 0.62);
  rightTread.castShadow = true;
  root.add(leftTread, rightTread);

  // Main chassis
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.48, 1.05), hullMat);
  hull.position.y = 0.42;
  hull.castShadow = true;
  hull.receiveShadow = true;
  root.add(hull);

  // Rear engine vent
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.65), darkMetal);
  engine.position.set(-0.55, 0.68, 0);
  root.add(engine);

  // Turret pivot
  const turret = new THREE.Group();
  turret.position.y = 0.76;

  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.34, 14), hullMat);
  cupola.castShadow = true;
  turret.add(cupola);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 1.15, 12), darkMetal);
  barrel.rotation.z = -Math.PI * 0.5;
  barrel.position.set(0.68, 0.02, 0);
  barrel.castShadow = true;
  turret.add(barrel);

  const muzzleGlow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 0.14, 12),
    new THREE.MeshBasicMaterial({ color: colorHex })
  );
  muzzleGlow.rotation.z = -Math.PI * 0.5;
  muzzleGlow.position.set(1.22, 0.02, 0);
  turret.add(muzzleGlow);

  root.add(turret);

  // Energy shield sphere
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(1.28, 20, 16),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.25,
      wireframe: true,
    })
  );
  shield.position.y = 0.6;
  shield.visible = false;
  root.add(shield);

  root.userData = { turret, shield, hullMat, baseColor: colorHex };
  return root;
}

export class TankArenaRenderer {
  constructor(sceneMgr) {
    this.sm = sceneMgr;
    this.group = new THREE.Group();
    this.tankMeshes = [];
    this.obstacleMeshes = new Map();
    this.bulletMeshes = new Map();
    this.powerupMeshes = new Map();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.6);
    this.raycaster = new THREE.Raycaster();
    this.aimPoint = new THREE.Vector3(0, 0.6, 0);
    this.aimReticle = null;
  }

  mount() {
    this.sm.clearWorld();
    this.sm.worldGroup.add(this.group);
    this.sm.setCamera(new THREE.Vector3(0, 21.5, 16.5), new THREE.Vector3(0, 0, 0.6), 46);

    // Arena floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 18),
      new THREE.MeshStandardMaterial({
        map: this.sm.textures.concrete,
        roughness: 0.85,
        metalness: 0.15,
      })
    );
    floor.rotation.x = -Math.PI * 0.5;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Outer perimeter steel walls
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.sm.textures.steel,
      color: 0x64748b,
      metalness: 0.75,
      roughness: 0.35,
    });
    const walls = [
      [29.2, 1.4, 0.6, 0, 0.7, -9.3],
      [29.2, 1.4, 0.6, 0, 0.7, 9.3],
      [0.6, 1.4, 18.0, -14.3, 0.7, 0],
      [0.6, 1.4, 18.0, 14.3, 0.7, 0],
    ];
    for (const [w, h, d, x, y, z] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }

    // Tanks
    this.tankMeshes = [
      createTankMesh(P_COLORS[0], this.sm.textures.steel),
      createTankMesh(P_COLORS[1], this.sm.textures.steel),
    ];
    this.group.add(this.tankMeshes[0], this.tankMeshes[1]);

    // Aim reticle
    this.aimReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.42, 20),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
    );
    this.aimReticle.rotation.x = -Math.PI * 0.5;
    this.aimReticle.position.y = 0.06;
    this.group.add(this.aimReticle);
  }

  sampleInput(inputMgr) {
    let mx = (inputMgr.isDown('KeyD') || inputMgr.isDown('ArrowRight') ? 1 : 0) -
             (inputMgr.isDown('KeyA') || inputMgr.isDown('ArrowLeft') ? 1 : 0);
    let mz = (inputMgr.isDown('KeyS') || inputMgr.isDown('ArrowDown') ? 1 : 0) -
             (inputMgr.isDown('KeyW') || inputMgr.isDown('ArrowUp') ? 1 : 0);

    this.raycaster.setFromCamera(inputMgr.mouseNdc, this.sm.camera);
    this.raycaster.ray.intersectPlane(this.aimPlane, this.aimPoint);
    if (this.aimReticle) {
      this.aimReticle.position.set(this.aimPoint.x, 0.08, this.aimPoint.z);
    }

    return {
      moveX: mx,
      moveZ: mz,
      aimX: this.aimPoint.x,
      aimZ: this.aimPoint.z,
      fire: inputMgr.mouseDown || inputMgr.isDown('Space'),
      dash: inputMgr.consumePress('ShiftLeft') || inputMgr.consumePress('ShiftRight'),
    };
  }

  handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'tank_fire') {
        SFX.play('tank_fire');
        this.sm.vfx.flashLight(ev.x, 0.8, ev.z, P_COLORS[ev.player], 12, 0.1);
      } else if (ev.type === 'ricochet') {
        SFX.play('ricochet');
        this.sm.vfx.burst(ev.x, 0.6, ev.z, 0xfbbf24, 7, 5, 0.25);
      } else if (ev.type === 'tank_hit') {
        SFX.play('explosion');
        this.sm.addShake(0.35);
        this.sm.vfx.burst(ev.x, 0.7, ev.z, 0xff6b35, 16, 7, 0.4);
      } else if (ev.type === 'tank_explode') {
        SFX.play('explosion');
        this.sm.addShake(0.95);
        this.sm.vfx.burst(ev.x, 0.8, ev.z, 0xff4500, 36, 12, 0.75);
        this.sm.vfx.shockwave(ev.x, 0.1, ev.z, 0xff8800, 6, 0.5);
        this.sm.vfx.flashLight(ev.x, 1.5, ev.z, 0xff6600, 30, 0.35);
      } else if (ev.type === 'crate_hit') {
        SFX.play('clack');
        this.sm.vfx.burst(ev.x, 0.7, ev.z, 0xc2854b, ev.destroyed ? 18 : 6, 6, 0.4);
      } else if (ev.type === 'powerup_pickup') {
        SFX.play('powerup');
        this.sm.vfx.shockwave(ev.x, 0.2, ev.z, 0x34d399, 3.2, 0.35);
      } else if (ev.type === 'tank_dash') {
        this.sm.vfx.burst(ev.x, 0.3, ev.z, P_COLORS[ev.player], 8, 4, 0.22);
      }
    }
  }

  update(state, dt) {
    if (!state) return;

    // Sync tanks
    for (const t of state.tanks) {
      const m = this.tankMeshes[t.index];
      if (!m) continue;
      m.visible = t.alive;
      m.position.x += (t.x - m.position.x) * Math.min(1, dt * 22);
      m.position.z += (t.z - m.position.z) * Math.min(1, dt * 22);
      m.rotation.y = -t.bodyAngle;
      m.userData.turret.rotation.y = -(t.turretAngle - t.bodyAngle);
      m.userData.shield.visible = t.shield;
      if (t.shield) m.userData.shield.rotation.y += dt * 2;
      m.userData.hullMat.emissive.setHex(t.hitFlash ? 0xffffff : 0x000000);
      m.userData.hullMat.emissiveIntensity = t.hitFlash ? 0.65 : 0;
    }

    // Sync obstacles
    const seenObs = new Set();
    for (const obs of state.obstacles) {
      seenObs.add(obs.id);
      let mesh = this.obstacleMeshes.get(obs.id);
      if (!mesh) {
        const h = obs.destructible ? 1.2 : 1.55;
        const mat = new THREE.MeshStandardMaterial({
          map: obs.destructible ? this.sm.textures.crate : this.sm.textures.steel,
          color: obs.destructible ? 0xd99b66 : 0x475569,
          roughness: obs.destructible ? 0.72 : 0.32,
          metalness: obs.destructible ? 0.15 : 0.78,
        });
        mesh = new THREE.Mesh(new THREE.BoxGeometry(obs.w, h, obs.h), mat);
        mesh.position.set(obs.x, h * 0.5, obs.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.obstacleMeshes.set(obs.id, mesh);
      }
      if (obs.destructible && obs.hp < obs.maxHp) {
        mesh.material.color.setHex(0x9a5b32);
      }
    }
    for (const [id, mesh] of this.obstacleMeshes) {
      if (!seenObs.has(id)) {
        this.group.remove(mesh);
        this.obstacleMeshes.delete(id);
      }
    }

    // Sync bullets
    const seenB = new Set();
    for (const b of state.bullets) {
      seenB.add(b.id);
      let mesh = this.bulletMeshes.get(b.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 12, 12),
          new THREE.MeshBasicMaterial({ color: b.owner === 0 ? 0x7dd3fc : 0xfda4af })
        );
        this.group.add(mesh);
        this.bulletMeshes.set(b.id, mesh);
      }
      mesh.position.set(b.x, 0.72, b.z);
    }
    for (const [id, mesh] of this.bulletMeshes) {
      if (!seenB.has(id)) {
        this.group.remove(mesh);
        this.bulletMeshes.delete(id);
      }
    }

    // Sync powerups
    const seenPu = new Set();
    const puColors = { shield: 0x38bdf8, triple: 0xf43f5e, rapid: 0xfbbf24, speed: 0x34d399 };
    for (const pu of state.powerups) {
      seenPu.add(pu.id);
      let mesh = this.powerupMeshes.get(pu.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.45, 0),
          new THREE.MeshStandardMaterial({
            color: puColors[pu.type] || 0xffffff,
            emissive: puColors[pu.type] || 0xffffff,
            emissiveIntensity: 0.7,
            metalness: 0.4,
            roughness: 0.2,
          })
        );
        mesh.position.set(pu.x, 0.75, pu.z);
        this.group.add(mesh);
        this.powerupMeshes.set(pu.id, mesh);
      }
      mesh.rotation.y += dt * 2.6;
      mesh.position.y = 0.75 + Math.sin(performance.now() * 0.005) * 0.16;
    }
    for (const [id, mesh] of this.powerupMeshes) {
      if (!seenPu.has(id)) {
        this.group.remove(mesh);
        this.powerupMeshes.delete(id);
      }
    }
  }

  getHudSummary(state, names) {
    if (!state) return { p1: 0, p2: 0, sub: '', bars: [] };
    return {
      p1: state.scores[0],
      p2: state.scores[1],
      sub: `ROUND ${state.round} • FIRST TO ${state.winRounds}`,
      bars: state.tanks.map((t, i) => ({
        label: `${names[i]} HP: ${t.hp}/${t.maxHp}${t.shield ? ' [SHIELD]' : ''}${t.tripleAmmo > 0 ? ' [TRIPLE]' : ''}`,
        pct: (t.hp / t.maxHp) * 100,
        color: i === 0 ? '#00e5ff' : '#ff5a36',
      })),
    };
  }

  unmount() {
    this.obstacleMeshes.clear();
    this.bulletMeshes.clear();
    this.powerupMeshes.clear();
  }
}
