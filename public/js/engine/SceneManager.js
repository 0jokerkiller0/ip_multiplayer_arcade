import * as THREE from 'three';
import { createAssetTextures } from './ProceduralTextures.js';
import { VFXManager } from './VFXManager.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#070b14');
    this.scene.fog = new THREE.FogExp2('#070b14', 0.015);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 180);
    this.camera.position.set(0, 18, 18);
    this.camera.lookAt(0, 0, 0);

    this.baseCamPos = new THREE.Vector3(0, 18, 18);
    this.camTarget = new THREE.Vector3(0, 0, 0);
    this.shake = 0;

    this.textures = createAssetTextures();
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);

    this.vfx = new VFXManager(this.scene);
    this._setupLighting();

    window.addEventListener('resize', () => this.onResize());
  }

  _setupLighting() {
    // Procedural studio environment map so PBR metallic materials catch crisp specular highlights
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x162238);
    const panelMat1 = new THREE.MeshBasicMaterial({ color: 0xbae6fd });
    const panelMat2 = new THREE.MeshBasicMaterial({ color: 0xfde68a });
    const panel1 = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), panelMat1);
    panel1.position.set(-12, 16, 8);
    panel1.lookAt(0, 0, 0);
    const panel2 = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), panelMat2);
    panel2.position.set(14, 16, -8);
    panel2.lookAt(0, 0, 0);
    envScene.add(panel1, panel2);
    this.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x1e293b, 1.25);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff7ed, 2.5);
    key.position.set(14, 26, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 2;
    key.shadow.camera.far = 75;
    key.shadow.camera.left = -22;
    key.shadow.camera.right = 22;
    key.shadow.camera.top = 22;
    key.shadow.camera.bottom = -22;
    key.shadow.bias = -0.0005;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x60a5fa, 0.75);
    fill.position.set(-14, 14, -12);
    this.scene.add(fill);

    const rimCyan = new THREE.PointLight(0x00e5ff, 22, 48, 1.5);
    rimCyan.position.set(-16, 7, -10);
    this.scene.add(rimCyan);

    const rimAmber = new THREE.PointLight(0xff5a36, 22, 48, 1.5);
    rimAmber.position.set(16, 7, 10);
    this.scene.add(rimAmber);
  }

  setCamera(pos, target, fov = 50) {
    this.baseCamPos.copy(pos);
    this.camTarget.copy(target);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
  }

  addShake(amount) {
    this.shake = Math.min(1.1, this.shake + amount);
  }

  clearWorld() {
    while (this.worldGroup.children.length > 0) {
      const obj = this.worldGroup.children[0];
      this.worldGroup.remove(obj);
    }
    this.vfx.clear();
  }

  update(dt) {
    this.vfx.update(dt);
    if (this.shake > 0.001) {
      const mag = this.shake * 0.45;
      this.camera.position.set(
        this.baseCamPos.x + (Math.random() - 0.5) * mag,
        this.baseCamPos.y + (Math.random() - 0.5) * mag,
        this.baseCamPos.z + (Math.random() - 0.5) * mag
      );
      this.shake = Math.max(0, this.shake - dt * 3.2);
    } else {
      this.camera.position.copy(this.baseCamPos);
    }
    this.camera.lookAt(this.camTarget);
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
