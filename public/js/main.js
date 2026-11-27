import * as THREE from 'three';
import { SceneManager } from './engine/SceneManager.js';
import { SFX } from './engine/SoundFX.js';
import { RENDERER_MAP } from './games/index.js';

class InputManager {
  constructor(canvas) {
    this.down = new Set();
    this.pressQueue = new Set();
    this.mouseNdc = new THREE.Vector2(0, 0);
    this.mouseDown = false;
    this.clicked = false;

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        if (document.activeElement?.tagName !== 'INPUT') e.preventDefault();
      }
      if (!this.down.has(e.code)) {
        this.pressQueue.add(e.code);
      }
      this.down.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });

    canvas.addEventListener('mousemove', (e) => {
      this.mouseNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this.clicked = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
  }

  isDown(code) {
    return this.down.has(code);
  }

  consumePress(code) {
    if (this.pressQueue.has(code)) {
      this.pressQueue.delete(code);
      return true;
    }
    return false;
  }

  consumeClick() {
    if (this.clicked) {
      this.clicked = false;
      return true;
    }
    return false;
  }
}

// DOM Elements
const canvas = document.getElementById('game-canvas');
const lobbyOverlay = document.getElementById('lobby-overlay');
const hudEl = document.getElementById('hud');
const centerBanner = document.getElementById('center-banner');
const bannerTitle = document.getElementById('banner-title');
const bannerSub = document.getElementById('banner-sub');
const matchOverEl = document.getElementById('match-over');

const shareUrlEl = document.getElementById('share-url');
const copyIpBtn = document.getElementById('copy-ip-btn');
const roomBadge = document.getElementById('room-badge');
const rolePill = document.getElementById('role-pill');
const pingPill = document.getElementById('ping-pill');
const muteBtn = document.getElementById('mute-btn');
const lobbyBtn = document.getElementById('lobby-btn');

const p1NameEl = document.getElementById('p1-name');
const p1StatusEl = document.getElementById('p1-status');
const p2NameEl = document.getElementById('p2-name');
const p2StatusEl = document.getElementById('p2-status');

const nameInput = document.getElementById('name-input');
const roomInput = document.getElementById('room-input');
const switchRoomBtn = document.getElementById('switch-room-btn');
const botToggleBtn = document.getElementById('bot-toggle-btn');
const gameGrid = document.getElementById('game-grid');
const selectedControls = document.getElementById('selected-controls');
const readyBtn = document.getElementById('ready-btn');
const startNowBtn = document.getElementById('start-now-btn');

const hudP1Name = document.getElementById('hud-p1-name');
const hudP2Name = document.getElementById('hud-p2-name');
const hudP1Score = document.getElementById('hud-p1-score');
const hudP2Score = document.getElementById('hud-p2-score');
const hudGameTitle = document.getElementById('hud-game-title');
const hudSub = document.getElementById('hud-sub');
const hudBars = document.getElementById('hud-bars');
const hudHint = document.getElementById('hud-hint');

const winnerHeading = document.getElementById('winner-heading');
const winnerReason = document.getElementById('winner-reason');
const rematchBtn = document.getElementById('rematch-btn');
const chooseOtherBtn = document.getElementById('choose-other-btn');
const toastEl = document.getElementById('toast');

const sceneMgr = new SceneManager(canvas);
const inputMgr = new InputManager(canvas);

let ws = null;
let myIndex = -1;
let catalog = [];
let roomState = null;
let gameState = null;
let activeRenderer = null;
let activeGameId = null;
let lobbyDiorama = null;

const params = new URLSearchParams(location.search);
let currentRoom = (params.get('room') || 'ARENA').toUpperCase();
roomInput.value = currentRoom;
let sessionId = sessionStorage.getItem('nexus_sid');
if (!sessionId) {
  sessionId = `sid_${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem('nexus_sid', sessionId);
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 2800);
}

function buildLobbyDiorama() {
  sceneMgr.clearWorld();
  sceneMgr.setCamera(new THREE.Vector3(0, 7.5, 13), new THREE.Vector3(0, 0.5, 0), 45);
  const g = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(32, 24),
    new THREE.MeshStandardMaterial({ map: sceneMgr.textures.neonGrid, roughness: 0.4, metalness: 0.5 })
  );
  floor.rotation.x = -Math.PI * 0.5;
  g.add(floor);

  const ring = new THREE.Mesh(
    new THREE.TorusKnotGeometry(1.8, 0.42, 90, 16),
    new THREE.MeshStandardMaterial({ color: 0x00e5ff, metalness: 0.85, roughness: 0.18, emissive: 0x0284c7, emissiveIntensity: 0.35 })
  );
  ring.position.y = 2.6;
  g.add(ring);
  sceneMgr.worldGroup.add(g);
  lobbyDiorama = ring;
}

buildLobbyDiorama();

// Fetch LAN IP URL from server
fetch('/api/info')
  .then((r) => r.json())
  .then((info) => {
    const lanUrl = info.lanUrls && info.lanUrls.length > 0 ? info.lanUrls[0] : location.origin;
    shareUrlEl.textContent = lanUrl;
  })
  .catch(() => {
    shareUrlEl.textContent = location.origin;
  });

copyIpBtn.onclick = async () => {
  try {
    await navigator.clipboard.writeText(shareUrlEl.textContent);
    showToast('LAN URL copied to clipboard!');
  } catch {
    showToast('Copy from address box: ' + shareUrlEl.textContent);
  }
};

muteBtn.onclick = () => {
  const on = SFX.toggleMute();
  muteBtn.textContent = on ? 'SFX ON' : 'SFX OFF';
};

function send(data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function connect(roomCode) {
  if (ws) ws.close();
  currentRoom = roomCode;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const name = encodeURIComponent(nameInput.value.trim());
  ws = new WebSocket(`${proto}://${location.host}?room=${encodeURIComponent(roomCode)}&name=${name}&sid=${encodeURIComponent(sessionId)}`);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'welcome') {
      myIndex = msg.playerIndex;
      catalog = msg.catalog || [];
      roomBadge.textContent = `ROOM: ${msg.roomCode}`;
      rolePill.textContent = myIndex === 0 ? 'YOU: PLAYER 1 (CYAN)' : myIndex === 1 ? 'YOU: PLAYER 2 (CORAL)' : 'SPECTATOR';
      renderCatalog();
    } else if (msg.type === 'room') {
      roomState = msg;
      syncUIWithRoom();
    } else if (msg.type === 'state') {
      gameState = msg.state;
      if (activeRenderer && msg.events?.length) {
        activeRenderer.handleEvents(msg.events);
      }
      updateHud();
    } else if (msg.type === 'pong') {
      pingPill.textContent = `${Math.max(1, Math.round(performance.now() - msg.t))} ms`;
    } else if (msg.type === 'notice') {
      showToast(msg.text);
    }
  };

  ws.onclose = () => {
    rolePill.textContent = 'Disconnected';
  };
}

connect(currentRoom);
setInterval(() => {
  if (ws && ws.readyState === 1) send({ type: 'ping', t: performance.now() });
}, 2000);

function renderCatalog() {
  gameGrid.innerHTML = '';
  for (const g of catalog) {
    const btn = document.createElement('button');
    btn.className = 'game-card';
    btn.style.setProperty('--card-accent', g.accent);
    btn.dataset.id = g.id;
    btn.innerHTML = `
      <div class="game-card-title">${g.title}</div>
      <div class="game-card-sub">${g.subtitle} • ${g.winCondition}</div>
      <div class="game-card-desc">${g.tagline}</div>
    `;
    btn.onclick = () => {
      SFX.play('click');
      send({ type: 'select_game', gameId: g.id });
    };
    gameGrid.appendChild(btn);
  }
}

function mountGameRenderer(gameId) {
  if (activeRenderer) activeRenderer.unmount();
  hudBars.innerHTML = '';
  hudP1Score.textContent = '0';
  hudP2Score.textContent = '0';
  const factory = RENDERER_MAP[gameId];
  if (!factory) return;
  lobbyDiorama = null;
  activeGameId = gameId;
  activeRenderer = factory(sceneMgr, (actionPayload) => {
    send({ type: 'input', data: actionPayload });
  });
  activeRenderer.mount(myIndex);
}

function syncUIWithRoom() {
  if (!roomState) return;
  const [p0, p1] = roomState.players;

  p1NameEl.textContent = p0 ? p0.name : 'Waiting...';
  p1StatusEl.textContent = p0 ? (p0.ready ? 'READY' : 'Connected') : 'Open Slot';
  p1StatusEl.className = `player-status ${p0?.ready ? 'ready' : ''}`;

  p2NameEl.textContent = p1 ? p1.name : 'Waiting...';
  p2StatusEl.textContent = p1 ? (p1.isBot ? 'AI Ready' : p1.ready ? 'READY' : 'Connected') : 'Share LAN IP to join';
  p2StatusEl.className = `player-status ${p1?.ready ? 'ready' : ''}`;

  botToggleBtn.textContent = `vs AI Bot: ${roomState.vsBot ? 'ON' : 'OFF'}`;
  botToggleBtn.classList.toggle('active', roomState.vsBot);

  const selectedMeta = catalog.find((c) => c.id === roomState.selectedGameId);
  document.querySelectorAll('.game-card').forEach((card) => {
    card.classList.toggle('selected', card.dataset.id === roomState.selectedGameId);
  });
  if (selectedMeta) {
    selectedControls.textContent = `Controls: ${selectedMeta.controls}`;
    hudGameTitle.textContent = selectedMeta.title.toUpperCase();
    hudHint.textContent = selectedMeta.controls;
  }

  const me = myIndex === 0 ? p0 : myIndex === 1 ? p1 : null;
  readyBtn.textContent = me?.ready ? 'CANCEL READY' : 'READY UP';

  if (roomState.status === 'lobby') {
    lobbyOverlay.classList.remove('hidden');
    hudEl.classList.add('hidden');
    centerBanner.classList.add('hidden');
    matchOverEl.classList.add('hidden');
    lobbyBtn.classList.add('hidden');
    if (activeRenderer) {
      activeRenderer.unmount();
      activeRenderer = null;
      activeGameId = null;
      buildLobbyDiorama();
    }
  } else if (roomState.status === 'countdown') {
    lobbyOverlay.classList.add('hidden');
    hudEl.classList.remove('hidden');
    matchOverEl.classList.add('hidden');
    lobbyBtn.classList.remove('hidden');
    centerBanner.classList.remove('hidden');
    bannerTitle.textContent = roomState.countdown > 0 ? String(roomState.countdown) : 'GO!';
    bannerSub.textContent = selectedMeta ? selectedMeta.title.toUpperCase() : 'GET READY';
    if (activeGameId !== roomState.selectedGameId) {
      gameState = null;
      mountGameRenderer(roomState.selectedGameId);
    }
  } else if (roomState.status === 'playing') {
    lobbyOverlay.classList.add('hidden');
    hudEl.classList.remove('hidden');
    matchOverEl.classList.add('hidden');
    lobbyBtn.classList.remove('hidden');
    if (activeGameId !== roomState.selectedGameId) {
      mountGameRenderer(roomState.selectedGameId);
    }
  } else if (roomState.status === 'match_over') {
    centerBanner.classList.add('hidden');
    matchOverEl.classList.remove('hidden');
    const res = roomState.lastResult;
    if (res) {
      const winnerPlayer = roomState.players[res.winner];
      winnerHeading.textContent = res.winner === -1 ? 'DRAW MATCH!' : `${winnerPlayer?.name || `Player ${res.winner + 1}`} WINS!`;
      winnerReason.textContent = res.reason || '';
    }
  }
}

function updateHud() {
  if (!roomState || !activeRenderer || !gameState) return;
  const names = [
    roomState.players[0]?.name || 'Player 1',
    roomState.players[1]?.name || 'Player 2',
  ];
  hudP1Name.textContent = names[0];
  hudP2Name.textContent = names[1];

  const summary = activeRenderer.getHudSummary(gameState, names);
  hudP1Score.textContent = String(summary.p1 ?? 0);
  hudP2Score.textContent = String(summary.p2 ?? 0);
  hudSub.textContent = summary.sub || '';

  hudBars.innerHTML = (summary.bars || [])
    .map(
      (b) => `
      <div class="status-chip">
        <div>${b.label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, b.pct))}%;background:${b.color}"></div></div>
      </div>`
    )
    .join('');

  if (roomState.status === 'playing') {
    if (gameState.roundPause > 0) {
      centerBanner.classList.remove('hidden');
      bannerTitle.textContent = gameState.roundWinner === -1 ? 'DRAW' : `ROUND TO P${gameState.roundWinner + 1}`;
      bannerSub.textContent = 'NEXT ROUND STARTING...';
    } else if (gameState.goalPause > 0) {
      centerBanner.classList.remove('hidden');
      bannerTitle.textContent = 'GOAL!';
      bannerSub.textContent = `${names[gameState.lastScorer]} SCORED`;
    } else {
      centerBanner.classList.add('hidden');
    }
  }
}

// Button handlers
nameInput.addEventListener('change', () => send({ type: 'set_name', name: nameInput.value }));
switchRoomBtn.onclick = () => connect(roomInput.value.trim().toUpperCase() || 'ARENA');
botToggleBtn.onclick = () => send({ type: 'toggle_bot', vsBot: !roomState?.vsBot });
readyBtn.onclick = () => {
  SFX.play('click');
  send({ type: 'ready' });
};
startNowBtn.onclick = () => {
  SFX.play('click');
  if (!roomState?.players[1] && !roomState?.vsBot) {
    showToast('Wait for Player 2 to join via your IP, or toggle "vs AI Bot: ON" to preview!');
    return;
  }
  send({ type: 'start_now' });
};
lobbyBtn.onclick = () => send({ type: 'back_to_lobby' });
chooseOtherBtn.onclick = () => send({ type: 'back_to_lobby' });
rematchBtn.onclick = () => send({ type: 'start_now' });

// Main 60Hz loop
let lastTime = performance.now();
let lastInputSend = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (lobbyDiorama) {
    lobbyDiorama.rotation.y += dt * 0.55;
    lobbyDiorama.rotation.x += dt * 0.25;
  }

  if (activeRenderer && roomState?.status === 'playing') {
    if ((myIndex === 0 || myIndex === 1) && now - lastInputSend >= 16) {
      const inp = activeRenderer.sampleInput(inputMgr);
      if (inp && Object.keys(inp).length > 0) {
        send({ type: 'input', data: inp });
      }
      lastInputSend = now;
    }
    activeRenderer.update(gameState, dt);
  }

  sceneMgr.update(dt);
}

requestAnimationFrame(animate);
