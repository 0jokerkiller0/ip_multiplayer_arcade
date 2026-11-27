import * as THREE from 'three';
import { SFX } from '../engine/SoundFX.js';

const CELL_SZ = 1.08;
const GRID_OFFSET = 6.8;

function makeShipMesh(size, horiz, isSunk = false) {
  const g = new THREE.Group();
  const len = size * CELL_SZ - 0.16;
  const hullMat = new THREE.MeshStandardMaterial({
    color: isSunk ? 0x7f1d1d : 0x64748b,
    metalness: 0.7,
    roughness: 0.35,
  });
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(horiz ? len : 0.74, 0.36, horiz ? 0.74 : len),
    hullMat
  );
  deck.position.y = 0.2;
  deck.castShadow = true;
  g.add(deck);

  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(horiz ? len * 0.26 : 0.48, 0.42, horiz ? 0.48 : len * 0.26),
    new THREE.MeshStandardMaterial({ color: isSunk ? 0x450a0a : 0x334155, metalness: 0.6, roughness: 0.4 })
  );
  bridge.position.y = 0.56;
  bridge.castShadow = true;
  g.add(bridge);

  const radar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.28, 8),
    new THREE.MeshBasicMaterial({ color: isSunk ? 0xef4444 : 0x38bdf8 })
  );
  radar.position.y = 0.9;
  g.add(radar);

  return g;
}

export class BattleshipRenderer {
  constructor(sceneMgr, sendAction) {
    this.sm = sceneMgr;
    this.sendAction = sendAction;
    this.group = new THREE.Group();
    this.ocean = null;
    this.dynamicGroup = new THREE.Group();
    this.hoverMarker = null;
    this.raycaster = new THREE.Raycaster();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.05);
    this.ability = 'strike';
    this.horiz = true;
    this.selectedShipId = 'carrier';
    this.lastState = null;
    this.dockEl = document.getElementById('battleship-dock');
    this.hoveredCell = null; // { board: 'my' | 'enemy', r, c }
  }

  mount() {
    this.sm.clearWorld();
    this.sm.worldGroup.add(this.group);
    this.sm.setCamera(new THREE.Vector3(0, 17.5, 13.5), new THREE.Vector3(0, 0, 0.5), 45);

    this.ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(42, 26),
      new THREE.MeshStandardMaterial({
        color: 0x0c4a6e,
        bumpMap: this.sm.textures.oceanBump,
        bumpScale: 0.28,
        roughness: 0.22,
        metalness: 0.5,
      })
    );
    this.ocean.rotation.x = -Math.PI * 0.5;
    this.ocean.receiveShadow = true;
    this.group.add(this.ocean);

    // Draw 10x10 grid frames for My Fleet (-X) and Enemy Radar (+X)
    for (const side of [-1, 1]) {
      const cx = side * GRID_OFFSET;
      const gridHelper = new THREE.GridHelper(10 * CELL_SZ, 10, side === -1 ? 0x00e5ff : 0xff5a36, 0x1e3a5f);
      gridHelper.position.set(cx, 0.04, 0);
      this.group.add(gridHelper);

      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(10 * CELL_SZ, 10 * CELL_SZ),
        new THREE.MeshBasicMaterial({
          color: side === -1 ? 0x082f49 : 0x1e1b4b,
          transparent: true,
          opacity: 0.35,
        })
      );
      plate.rotation.x = -Math.PI * 0.5;
      plate.position.set(cx, 0.02, 0);
      this.group.add(plate);
    }

    this.hoverMarker = new THREE.Mesh(
      new THREE.BoxGeometry(CELL_SZ * 0.94, 0.14, CELL_SZ * 0.94),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.6 })
    );
    this.hoverMarker.visible = false;
    this.group.add(this.hoverMarker);
    this.group.add(this.dynamicGroup);

    if (this.dockEl) {
      this.dockEl.classList.remove('hidden');
      this._renderDock();
    }
  }

  _cellToWorld(isEnemyBoard, r, c) {
    const cx = (isEnemyBoard ? 1 : -1) * GRID_OFFSET;
    const x = cx + (c - 4.5) * CELL_SZ;
    const z = (r - 4.5) * CELL_SZ;
    return { x, z };
  }

  _worldToCell(wx, wz) {
    for (const isEnemy of [false, true]) {
      const cx = (isEnemy ? 1 : -1) * GRID_OFFSET;
      const relX = wx - cx + 5 * CELL_SZ;
      const relZ = wz + 5 * CELL_SZ;
      const c = Math.floor(relX / CELL_SZ);
      const r = Math.floor(relZ / CELL_SZ);
      if (r >= 0 && r < 10 && c >= 0 && c < 10) {
        return { board: isEnemy ? 'enemy' : 'my', r, c };
      }
    }
    return null;
  }

  _renderDock() {
    if (!this.dockEl) return;
    const st = this.lastState;
    if (!st) {
      this.dockEl.innerHTML = '<span>Initializing Naval Command...</span>';
      return;
    }

    if (st.phase === 'setup') {
      const locked = st.locked[st.myIndex];
      const shipBtns = st.myShips
        .map(
          (s) =>
            `<button class="dock-btn ${this.selectedShipId === s.id ? 'active' : ''}" data-ship="${s.id}">${s.name} (${s.size})</button>`
        )
        .join('');
      this.dockEl.innerHTML = `
        <span>SETUP (${st.setupTimer}s):</span>
        ${shipBtns}
        <button class="dock-btn" data-act="rotate">Rotate (${this.horiz ? 'H' : 'V'})</button>
        <button class="dock-btn" data-act="randomize">Randomize</button>
        <button class="btn-small" data-act="lock" ${locked ? 'disabled' : ''}>${locked ? 'FLEET LOCKED' : 'LOCK FLEET'}</button>
      `;
    } else {
      const myTurn = st.turn === st.myIndex;
      const cds = st.cooldowns || {};
      this.dockEl.innerHTML = `
        <span>${myTurn ? 'YOUR TURN' : 'ENEMY TURN'} (${st.turnTimer}s):</span>
        <button class="dock-btn ${this.ability === 'strike' ? 'active' : ''}" data-ab="strike" ${!myTurn ? 'disabled' : ''}>Strike</button>
        <button class="dock-btn ${this.ability === 'sonar' ? 'active' : ''}" data-ab="sonar" ${!myTurn || cds.sonar > 0 ? 'disabled' : ''}>Sonar${cds.sonar > 0 ? ` (${cds.sonar})` : ''}</button>
        <button class="dock-btn ${this.ability === 'airstrike' ? 'active' : ''}" data-ab="airstrike" ${!myTurn || cds.airstrike > 0 ? 'disabled' : ''}>Airstrike${cds.airstrike > 0 ? ` (${cds.airstrike})` : ''}</button>
        <button class="dock-btn ${this.ability === 'shield' ? 'active' : ''}" data-ab="shield" ${!myTurn || cds.shield > 0 ? 'disabled' : ''}>EMP Shield${cds.shield > 0 ? ` (${cds.shield})` : ''}</button>
        <button class="dock-btn" data-act="rotate">Orient: ${this.horiz ? 'Horiz' : 'Vert'}</button>
      `;
    }

    this.dockEl.querySelectorAll('[data-ship]').forEach((btn) => {
      btn.onclick = () => {
        this.selectedShipId = btn.dataset.ship;
        this._renderDock();
      };
    });
    this.dockEl.querySelectorAll('[data-ab]').forEach((btn) => {
      btn.onclick = () => {
        this.ability = btn.dataset.ab;
        this._renderDock();
      };
    });
    this.dockEl.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = () => {
        const act = btn.dataset.act;
        if (act === 'rotate') {
          this.horiz = !this.horiz;
          this._renderDock();
        } else if (act === 'randomize') {
          this.sendAction({ action: 'randomize' });
        } else if (act === 'lock') {
          this.sendAction({ action: 'lock' });
        }
      };
    });
  }

  sampleInput(inputMgr) {
    if (inputMgr.consumePress('KeyR')) {
      this.horiz = !this.horiz;
      this._renderDock();
    }

    this.raycaster.setFromCamera(inputMgr.mouseNdc, this.sm.camera);
    const hitPt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.boardPlane, hitPt)) {
      this.hoveredCell = this._worldToCell(hitPt.x, hitPt.z);
    } else {
      this.hoveredCell = null;
    }

    if (this.hoverMarker) {
      if (this.hoveredCell) {
        const w = this._cellToWorld(this.hoveredCell.board === 'enemy', this.hoveredCell.r, this.hoveredCell.c);
        this.hoverMarker.visible = true;
        this.hoverMarker.position.set(w.x, 0.1, w.z);
      } else {
        this.hoverMarker.visible = false;
      }
    }

    if (inputMgr.consumeClick() && this.hoveredCell && this.lastState) {
      const st = this.lastState;
      if (st.phase === 'setup' && this.hoveredCell.board === 'my') {
        this.sendAction({
          action: 'placeShip',
          shipId: this.selectedShipId,
          r: this.hoveredCell.r,
          c: this.hoveredCell.c,
          horiz: this.horiz,
        });
      } else if (st.phase === 'combat' && st.turn === st.myIndex) {
        if (this.ability === 'shield' && this.hoveredCell.board === 'my') {
          this.sendAction({ action: 'fire', ability: 'shield', r: this.hoveredCell.r, c: this.hoveredCell.c });
          this.ability = 'strike';
        } else if (this.ability !== 'shield' && this.hoveredCell.board === 'enemy') {
          this.sendAction({
            action: 'fire',
            ability: this.ability,
            r: this.hoveredCell.r,
            c: this.hoveredCell.c,
            horiz: this.horiz,
          });
          this.ability = 'strike';
        }
      }
    }
    return {};
  }

  handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'naval_hit') {
        SFX.play('explosion');
        this.sm.addShake(0.45);
        const isEnemy = ev.attacker === this.lastState?.myIndex;
        const w = this._cellToWorld(isEnemy, ev.r, ev.c);
        this.sm.vfx.burst(w.x, 0.5, w.z, 0xff5500, 18, 7, 0.5);
      } else if (ev.type === 'naval_miss') {
        SFX.play('splash');
        const isEnemy = ev.attacker === this.lastState?.myIndex;
        const w = this._cellToWorld(isEnemy, ev.r, ev.c);
        this.sm.vfx.burst(w.x, 0.3, w.z, 0xbae6fd, 12, 5, 0.35);
      } else if (ev.type === 'sonar_ping') {
        SFX.play('sonar');
        const w = this._cellToWorld(true, ev.r, ev.c);
        this.sm.vfx.shockwave(w.x, 0.2, w.z, 0x38bdf8, 4.5, 0.55);
      } else if (ev.type === 'shield_deployed') {
        SFX.play('powerup');
      }
    }
  }

  update(state, dt) {
    if (!state) return;
    const phaseChanged = !this.lastState || this.lastState.phase !== state.phase || this.lastState.turn !== state.turn || this.lastState.setupTimer !== state.setupTimer || this.lastState.turnTimer !== state.turnTimer;
    this.lastState = state;
    if (phaseChanged) this._renderDock();

    if (this.ocean) {
      this.sm.textures.oceanBump.offset.x += dt * 0.03;
      this.sm.textures.oceanBump.offset.y += dt * 0.02;
    }

    // Rebuild tactical markers cleanly
    while (this.dynamicGroup.children.length > 0) {
      this.dynamicGroup.remove(this.dynamicGroup.children[0]);
    }

    // My ships
    for (const s of state.myShips) {
      const centerR = s.horiz ? s.r : s.r + (s.size - 1) * 0.5;
      const centerC = s.horiz ? s.c + (s.size - 1) * 0.5 : s.c;
      const w = this._cellToWorld(false, centerR, centerC);
      const mesh = makeShipMesh(s.size, s.horiz, s.sunk);
      mesh.position.set(w.x, 0, w.z);
      this.dynamicGroup.add(mesh);
    }

    // Enemy sunk ships
    for (const s of state.enemySunkShips) {
      const centerR = s.horiz ? s.r : s.r + (s.size - 1) * 0.5;
      const centerC = s.horiz ? s.c + (s.size - 1) * 0.5 : s.c;
      const w = this._cellToWorld(true, centerR, centerC);
      const mesh = makeShipMesh(s.size, s.horiz, true);
      mesh.position.set(w.x, 0, w.z);
      this.dynamicGroup.add(mesh);
    }

    // Shots on both boards
    const renderShots = (shots, isEnemy) => {
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          const val = shots[r][c];
          if (!val) continue;
          const w = this._cellToWorld(isEnemy, r, c);
          const col = val === 'hit' ? 0xef4444 : val === 'shielded' ? 0x38bdf8 : 0xe2e8f0;
          const marker = new THREE.Mesh(
            new THREE.CylinderGeometry(0.24, 0.24, val === 'hit' ? 0.65 : 0.22, 12),
            new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: val === 'hit' ? 0.9 : 0.2 })
          );
          marker.position.set(w.x, 0.35, w.z);
          this.dynamicGroup.add(marker);
        }
      }
    };
    renderShots(state.myIncomingShots, false);
    renderShots(state.enemyShots, true);

    // My EMP shields
    for (const sh of state.myShields) {
      const w = this._cellToWorld(false, sh.r + 0.5, sh.c + 0.5);
      const dome = new THREE.Mesh(
        new THREE.BoxGeometry(CELL_SZ * 2, 0.55, CELL_SZ * 2),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.28, wireframe: true })
      );
      dome.position.set(w.x, 0.3, w.z);
      this.dynamicGroup.add(dome);
    }

    // Sonar ping markers
    for (const sn of state.sonarMarks) {
      const w = this._cellToWorld(true, sn.r, sn.c);
      const col = sn.count > 0 ? 0xfbbf24 : 0x64748b;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.1, 1.45, 24),
        new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
      );
      ring.rotation.x = -Math.PI * 0.5;
      ring.position.set(w.x, 0.12, w.z);
      this.dynamicGroup.add(ring);
    }
  }

  getHudSummary(state, names) {
    if (!state) return { p1: 0, p2: 0, sub: '', bars: [] };
    const myAlive = state.myShips.filter((s) => !s.sunk).length;
    const enemyAlive = state.enemyShipsRemaining;
    return {
      p1: state.myIndex === 0 ? myAlive : enemyAlive,
      p2: state.myIndex === 1 ? myAlive : enemyAlive,
      sub: state.phase === 'setup' ? `FLEET SETUP • ${state.setupTimer}s` : `TURN ${state.turnCount} • ${state.turn === state.myIndex ? 'YOUR MOVE' : 'OPPONENT MOVE'}`,
      bars: [
        { label: `${names[state.myIndex]} Fleet Alive: ${myAlive}/5`, pct: (myAlive / 5) * 100, color: '#00e5ff' },
        { label: `Enemy Fleet Alive: ${enemyAlive}/5`, pct: (enemyAlive / 5) * 100, color: '#ff5a36' },
      ],
    };
  }

  unmount() {
    if (this.dockEl) this.dockEl.classList.add('hidden');
  }
}
