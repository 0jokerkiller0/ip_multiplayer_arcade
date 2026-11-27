import { GAME_REGISTRY, getGameEntry, getPublicCatalog } from './games/registry.js';

const TICK_HZ = 60;
const TICK_DT = 1 / TICK_HZ;
const BROADCAST_EVERY = 2; // 30Hz snapshots over LAN

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  getOrCreateRoom(roomCode = 'ARENA') {
    const code = String(roomCode || 'ARENA').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12) || 'ARENA';
    if (!this.rooms.has(code)) {
      this.rooms.set(code, this._createRoom(code));
    }
    return this.rooms.get(code);
  }

  _createRoom(code) {
    const room = {
      code,
      status: 'lobby', // 'lobby' | 'countdown' | 'playing' | 'match_over'
      selectedGameId: GAME_REGISTRY[0].id,
      vsBot: false,
      countdownTimer: 0,
      tickCount: 0,
      players: [null, null], // { socket, name, ready, sessionId }
      spectators: new Set(),
      game: null,
      lastResult: null,
      interval: null,
    };
    return room;
  }

  joinRoom(socket, { roomCode, name, sessionId }) {
    const room = this.getOrCreateRoom(roomCode);
    const cleanName = String(name || '').trim().slice(0, 16);

    // Reconnect check
    let slot = room.players.findIndex((p) => p && sessionId && p.sessionId === sessionId);
    if (slot === -1) {
      slot = room.players.findIndex((p) => p === null);
    }

    let role = 'spectator';
    if (slot === 0 || slot === 1) {
      role = 'player';
      const defaultName = `Player ${slot + 1}`;
      room.players[slot] = {
        socket,
        name: cleanName || room.players[slot]?.name || defaultName,
        ready: false,
        sessionId: sessionId || `s_${Date.now()}_${slot}`,
      };
    } else {
      room.spectators.add(socket);
    }

    socket._arcadeRoom = room;
    socket._arcadeSlot = role === 'player' ? slot : -1;

    this._send(socket, {
      type: 'welcome',
      roomCode: room.code,
      playerIndex: socket._arcadeSlot,
      role,
      catalog: getPublicCatalog(),
    });

    this.broadcastRoomState(room);
    return { room, playerIndex: socket._arcadeSlot };
  }

  handleMessage(socket, msg) {
    const room = socket._arcadeRoom;
    if (!room || !msg || typeof msg !== 'object') return;
    const slot = socket._arcadeSlot;

    switch (msg.type) {
      case 'ping':
        this._send(socket, { type: 'pong', t: msg.t });
        break;

      case 'set_name':
        if (slot === 0 || slot === 1) {
          const clean = String(msg.name || '').trim().slice(0, 16);
          if (clean && room.players[slot]) {
            room.players[slot].name = clean;
            this.broadcastRoomState(room);
          }
        }
        break;

      case 'select_game':
        if ((slot === 0 || slot === 1) && (room.status === 'lobby' || room.status === 'match_over')) {
          if (getGameEntry(msg.gameId)) {
            room.selectedGameId = msg.gameId;
            room.status = 'lobby';
            room.lastResult = null;
            for (const p of room.players) {
              if (p) p.ready = false;
            }
            this.broadcastRoomState(room);
          }
        }
        break;

      case 'toggle_bot':
        if ((slot === 0 || slot === 1) && (room.status === 'lobby' || room.status === 'match_over')) {
          room.vsBot = Boolean(msg.vsBot);
          this.broadcastRoomState(room);
        }
        break;

      case 'ready':
        if (slot === 0 || slot === 1) {
          if (room.players[slot]) {
            room.players[slot].ready = msg.ready !== undefined ? Boolean(msg.ready) : !room.players[slot].ready;
          }
          this._checkStartCondition(room);
          this.broadcastRoomState(room);
        }
        break;

      case 'start_now':
        if (slot === 0 || slot === 1) {
          if (room.players[0] && (room.players[1] || room.vsBot)) {
            this._beginCountdown(room);
          }
        }
        break;

      case 'back_to_lobby':
        if (slot === 0 || slot === 1) {
          this._stopLoop(room);
          room.status = 'lobby';
          room.game = null;
          room.lastResult = null;
          for (const p of room.players) {
            if (p) p.ready = false;
          }
          this.broadcastRoomState(room);
        }
        break;

      case 'input':
        if ((slot === 0 || slot === 1) && room.status === 'playing' && room.game) {
          room.game.onPlayerInput(slot, msg.data || {});
        }
        break;

      default:
        break;
    }
  }

  handleDisconnect(socket) {
    const room = socket._arcadeRoom;
    if (!room) return;
    const slot = socket._arcadeSlot;

    if (slot === 0 || slot === 1) {
      if (room.players[slot] && room.players[slot].socket === socket) {
        room.players[slot] = null;
      }
      if (room.status === 'playing' || room.status === 'countdown') {
        this._stopLoop(room);
        room.status = 'lobby';
        room.game = null;
        this.broadcast(room, { type: 'notice', text: `Player ${slot + 1} disconnected. Returned to lobby.` });
      }
    } else {
      room.spectators.delete(socket);
    }

    if (!room.players[0] && !room.players[1] && room.spectators.size === 0) {
      this._stopLoop(room);
      this.rooms.delete(room.code);
    } else {
      this.broadcastRoomState(room);
    }
  }

  _checkStartCondition(room) {
    if (room.status !== 'lobby' && room.status !== 'match_over') return;
    const p0Ready = Boolean(room.players[0]?.ready);
    const p1Ready = room.vsBot ? true : Boolean(room.players[1]?.ready);
    if (p0Ready && (room.vsBot ? room.players[0] || room.players[1] : p1Ready)) {
      this._beginCountdown(room);
    }
  }

  _beginCountdown(room) {
    const entry = getGameEntry(room.selectedGameId);
    if (!entry) return;
    this._stopLoop(room);
    room.status = 'countdown';
    room.countdownTimer = 2.0;
    room.tickCount = 0;
    room.lastResult = null;
    room.game = entry.create();
    room.game.onStart();
    this.broadcastRoomState(room);

    room.interval = setInterval(() => this._tickRoom(room), 1000 / TICK_HZ);
  }

  _tickRoom(room) {
    if (room.status === 'countdown') {
      room.countdownTimer -= TICK_DT;
      if (room.countdownTimer <= 0) {
        room.status = 'playing';
        this.broadcastRoomState(room);
        this._broadcastGameState(room, []);
      } else if (room.tickCount % 15 === 0) {
        this.broadcastRoomState(room);
      }
      room.tickCount += 1;
      return;
    }

    if (room.status !== 'playing' || !room.game) return;

    // Bot AI drives unoccupied slot if vsBot enabled
    if (room.vsBot) {
      const botSlot = room.players[1] === null ? 1 : room.players[0] === null ? 0 : -1;
      if (botSlot !== -1) {
        const botInp = room.game.computeBotInput(botSlot);
        if (botInp && Object.keys(botInp).length > 0) {
          room.game.onPlayerInput(botSlot, botInp);
        }
      }
    }

    room.game.step(TICK_DT);
    room.tickCount += 1;

    const events = room.game.drainEvents();
    const res = room.game.getResult();

    if (res) {
      room.status = 'match_over';
      room.lastResult = res;
      this._broadcastGameState(room, events);
      this.broadcastRoomState(room);
      this._stopLoop(room);
      return;
    }

    if (events.length > 0 || room.tickCount % BROADCAST_EVERY === 0) {
      this._broadcastGameState(room, events);
    }
  }

  _stopLoop(room) {
    if (room.interval) {
      clearInterval(room.interval);
      room.interval = null;
    }
  }

  _broadcastGameState(room, events) {
    if (!room.game) return;
    for (let i = 0; i < 2; i++) {
      const p = room.players[i];
      if (p?.socket) {
        this._send(p.socket, {
          type: 'state',
          state: room.game.getState(i),
          events,
        });
      }
    }
    if (room.spectators.size > 0) {
      const specState = room.game.getState(-1);
      for (const s of room.spectators) {
        this._send(s, { type: 'state', state: specState, events });
      }
    }
  }

  broadcastRoomState(room) {
    const payload = {
      type: 'room',
      roomCode: room.code,
      status: room.status,
      selectedGameId: room.selectedGameId,
      vsBot: room.vsBot,
      countdown: Math.max(0, Math.ceil(room.countdownTimer)),
      lastResult: room.lastResult,
      players: room.players.map((p, idx) =>
        p
          ? { index: idx, name: p.name, ready: p.ready, connected: true }
          : room.vsBot && idx === 1
          ? { index: idx, name: 'Cyber Bot (AI)', ready: true, connected: true, isBot: true }
          : null
      ),
      spectators: room.spectators.size,
    };
    this.broadcast(room, payload);
  }

  broadcast(room, data) {
    for (const p of room.players) {
      if (p?.socket) this._send(p.socket, data);
    }
    for (const s of room.spectators) {
      this._send(s, data);
    }
  }

  _send(socket, data) {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(data));
    }
  }
}
