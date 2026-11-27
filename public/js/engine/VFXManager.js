import * as THREE from 'three';

export class VFXManager {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.particles = [];
    this.rings = [];
    this.flashes = [];

    this.sphereGeo = new THREE.SphereGeometry(0.14, 8, 8);
    this.ringGeo = new THREE.RingGeometry(0.35, 0.52, 24);
  }

  burst(x, y, z, color = 0xffaa00, count = 16, speed = 8, life = 0.55) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.sphereGeo, mat.clone());
      mesh.position.set(x, y, z);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.65;
      const spd = speed * (0.45 + Math.random() * 0.75);
      const vx = Math.cos(theta) * Math.sin(phi) * spd;
      const vy = Math.cos(phi) * spd + 1.5;
      const vz = Math.sin(theta) * Math.sin(phi) * spd;
      this.group.add(mesh);
      this.particles.push({ mesh, vx, vy, vz, life, maxLife: life });
    }
  }

  shockwave(x, y, z, color = 0x00e5ff, maxScale = 4.5, life = 0.42) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.rings.push({ mesh, maxScale, life, maxLife: life });
  }

  flashLight(x, y, z, color = 0xffaa33, intensity = 16, life = 0.16) {
    const light = new THREE.PointLight(color, intensity, 14, 1.5);
    light.position.set(x, y, z);
    this.group.add(light);
    this.flashes.push({ light, intensity, life, maxLife: life });
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.mesh);
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= 18 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      const ratio = p.life / p.maxLife;
      p.mesh.scale.setScalar(0.3 + ratio * 0.9);
      p.mesh.material.opacity = ratio;
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.group.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const prog = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(1 + prog * r.maxScale);
      r.mesh.material.opacity = (1 - prog) * 0.85;
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.group.remove(f.light);
        this.flashes.splice(i, 1);
        continue;
      }
      f.light.intensity = f.intensity * (f.life / f.maxLife);
    }
  }

  clear() {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.particles = [];
    this.rings = [];
    this.flashes = [];
  }
}
