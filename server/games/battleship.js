import { BaseGame } from './BaseGame.js';
import { clamp } from './math.js';

const GRID_SIZE = 10;
const SETUP_TIME = 45;
const TURN_TIME = 25;

export const FLEET_SPEC = [
  { id: 'carrier', name: 'Carrier', size: 5 },
  { id: 'battleship', name: 'Battleship', size: 4 },
  { id: 'cruiser', name: 'Cruiser', size: 3 },
  { id: 'submarine', name: 'Submarine', size: 3 },
  { id: 'destroyer', name: 'Destroyer', size: 2 },
];

export class BattleshipGame extends BaseGame {
  constructor() {
    super('battleship');
    this.phase = 'setup'; // 'setup' | 'combat'
    this.setupTimer = SETUP_TIME;
    this.turnTimer = TURN_TIME;
    this.turn = 0;
    this.turnCount = 1;
    this.botThinkTimer = 0;

    this.boards = [this._createBoard(), this._createBoard()];
    this.randomizeFleet(0);
    this.randomizeFleet(1);
  }

  _createBoard() {
    return {
      ships: [],
      locked: false,
      incomingShots: Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null)), // null | 'miss' | 'hit' | 'shielded'
      sonarMarks: [], // { r, c, count }
      shields: [], // { r, c, ttl }
      cooldowns: { sonar: 0, airstrike: 0, shield: 0 },
    };
  }

  _canPlace(ships, r, c, size, horiz, ignoreId = null) {
    for (let i = 0; i < size; i++) {
      const rr = horiz ? r : r + i;
      const cc = horiz ? c + i : c;
      if (rr < 0 || rr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) return false;
      for (const s of ships) {
        if (s.id === ignoreId) continue;
        for (const cell of s.cells) {
          if (cell.r === rr && cell.c === cc) return false;
        }
      }
    }
    return true;
  }

  randomizeFleet(playerIndex) {
    const board = this.boards[playerIndex];
    if (this.phase !== 'setup' || board.locked) return false;
    const ships = [];
    for (const spec of FLEET_SPEC) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const horiz = Math.random() > 0.5;
        const r = Math.floor(Math.random() * GRID_SIZE);
        const c = Math.floor(Math.random() * GRID_SIZE);
        if (this._canPlace(ships, r, c, spec.size, horiz)) {
          const cells = [];
          for (let i = 0; i < spec.size; i++) {
            cells.push({ r: horiz ? r : r + i, c: horiz ? c + i : c, hit: false });
          }
          ships.push({ id: spec.id, name: spec.name, size: spec.size, horiz, r, c, cells, sunk: false });
          placed = true;
        }
      }
    }
    board.ships = ships;
    return true;
  }

  _placeShip(playerIndex, shipId, r, c, horiz) {
    const board = this.boards[playerIndex];
    if (this.phase !== 'setup' || board.locked) return false;
    const idx = board.ships.findIndex((s) => s.id === shipId);
    if (idx === -1) return false;
    const spec = board.ships[idx];
    if (!this._canPlace(board.ships, r, c, spec.size, horiz, shipId)) return false;
    const cells = [];
    for (let i = 0; i < spec.size; i++) {
      cells.push({ r: horiz ? r : r + i, c: horiz ? c + i : c, hit: false });
    }
    board.ships[idx] = { ...spec, r, c, horiz, cells };
    return true;
  }

  _startCombat() {
    this.phase = 'combat';
    this.turn = 0;
    this.turnTimer = TURN_TIME;
    this.emitEvent('combat_start', {});
  }

  onPlayerInput(playerIndex, input) {
    if ((playerIndex !== 0 && playerIndex !== 1) || this.result) return;
    const board = this.boards[playerIndex];

    if (this.phase === 'setup') {
      if (input.action === 'randomize') {
        this.randomizeFleet(playerIndex);
      } else if (input.action === 'placeShip') {
        this._placeShip(playerIndex, input.shipId, Number(input.r), Number(input.c), Boolean(input.horiz));
      } else if (input.action === 'lock') {
        board.locked = true;
        this.emitEvent('fleet_locked', { player: playerIndex });
        if (this.boards[0].locked && this.boards[1].locked) {
          this._startCombat();
        }
      }
      return;
    }

    if (this.phase === 'combat' && playerIndex === this.turn) {
      if (input.action === 'fire') {
        this._executeTurnAction(
          playerIndex,
          input.ability || 'strike',
          clamp(Math.floor(Number(input.r) || 0), 0, GRID_SIZE - 1),
          clamp(Math.floor(Number(input.c) || 0), 0, GRID_SIZE - 1),
          Boolean(input.horiz)
        );
      }
    }
  }

  _applySingleHit(targetBoard, attackerIndex, r, c) {
    if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return null;
    if (targetBoard.incomingShots[r][c] !== null && targetBoard.incomingShots[r][c] !== 'shielded') {
      return null;
    }

    // Check EMP shield on target cell
    const shieldIdx = targetBoard.shields.findIndex(
      (sh) => r >= sh.r && r <= sh.r + 1 && c >= sh.c && c <= sh.c + 1
    );
    if (shieldIdx !== -1) {
      targetBoard.shields.splice(shieldIdx, 1);
      targetBoard.incomingShots[r][c] = 'shielded';
      this.emitEvent('emp_blocked', { attacker: attackerIndex, r, c });
      return 'shielded';
    }

    for (const ship of targetBoard.ships) {
      for (const cell of ship.cells) {
        if (cell.r === r && cell.c === c) {
          cell.hit = true;
          targetBoard.incomingShots[r][c] = 'hit';
          const wasSunk = ship.sunk;
          ship.sunk = ship.cells.every((x) => x.hit);
          this.emitEvent('naval_hit', {
            attacker: attackerIndex,
            r,
            c,
            sunk: !wasSunk && ship.sunk ? ship.name : null,
          });
          return 'hit';
        }
      }
    }

    targetBoard.incomingShots[r][c] = 'miss';
    this.emitEvent('naval_miss', { attacker: attackerIndex, r, c });
    return 'miss';
  }

  _executeTurnAction(attackerIndex, ability, r, c, horiz) {
    const myBoard = this.boards[attackerIndex];
    const enemyIndex = attackerIndex === 0 ? 1 : 0;
    const enemyBoard = this.boards[enemyIndex];

    let acted = false;

    if (ability === 'sonar' && myBoard.cooldowns.sonar === 0) {
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) continue;
          for (const ship of enemyBoard.ships) {
            if (ship.cells.some((cell) => cell.r === rr && cell.c === cc && !cell.hit)) {
              count += 1;
            }
          }
        }
      }
      myBoard.sonarMarks.push({ r, c, count });
      myBoard.cooldowns.sonar = 3;
      this.emitEvent('sonar_ping', { attacker: attackerIndex, r, c, count });
      acted = true;
    } else if (ability === 'airstrike' && myBoard.cooldowns.airstrike === 0) {
      for (let i = -1; i <= 1; i++) {
        const rr = horiz ? r : clamp(r + i, 0, GRID_SIZE - 1);
        const cc = horiz ? clamp(c + i, 0, GRID_SIZE - 1) : c;
        this._applySingleHit(enemyBoard, attackerIndex, rr, cc);
      }
      myBoard.cooldowns.airstrike = 4;
      this.emitEvent('airstrike', { attacker: attackerIndex, r, c, horiz });
      acted = true;
    } else if (ability === 'shield' && myBoard.cooldowns.shield === 0) {
      const sr = clamp(r, 0, GRID_SIZE - 2);
      const sc = clamp(c, 0, GRID_SIZE - 2);
      myBoard.shields.push({ r: sr, c: sc });
      myBoard.cooldowns.shield = 5;
      this.emitEvent('shield_deployed', { player: attackerIndex, r: sr, c: sc });
      acted = true;
    } else {
      const outcome = this._applySingleHit(enemyBoard, attackerIndex, r, c);
      if (outcome !== null) acted = true;
    }

    if (!acted) return;

    // Check victory
    if (enemyBoard.ships.every((s) => s.sunk)) {
      const remaining = myBoard.ships.filter((s) => !s.sunk).length;
      const scores = attackerIndex === 0 ? [remaining, 0] : [0, remaining];
      this.result = {
        winner: attackerIndex,
        reason: `Player ${attackerIndex + 1} sank the entire enemy fleet!`,
        scores,
      };
      return;
    }

    // Tick cooldowns for attacker and pass turn
    for (const key of Object.keys(myBoard.cooldowns)) {
      if (myBoard.cooldowns[key] > 0) myBoard.cooldowns[key] -= 1;
    }
    this.turn = enemyIndex;
    this.turnCount += 1;
    this.turnTimer = TURN_TIME;
    this.botThinkTimer = 0.75;
  }

  step(dt) {
    super.step(dt);
    if (this.result) return;

    if (this.phase === 'setup') {
      this.setupTimer -= dt;
      if (this.setupTimer <= 0) {
        this.boards[0].locked = true;
        this.boards[1].locked = true;
        this._startCombat();
      }
    } else if (this.phase === 'combat') {
      this.turnTimer -= dt;
      this.botThinkTimer = Math.max(0, this.botThinkTimer - dt);
      if (this.turnTimer <= 0) {
        // Auto-strike an unhit tile on timeout
        const enemy = this.boards[this.turn === 0 ? 1 : 0];
        const choices = [];
        for (let r = 0; r < GRID_SIZE; r++) {
          for (let c = 0; c < GRID_SIZE; c++) {
            if (enemy.incomingShots[r][c] === null) choices.push({ r, c });
          }
        }
        if (choices.length > 0) {
          const pick = choices[Math.floor(Math.random() * choices.length)];
          this._executeTurnAction(this.turn, 'strike', pick.r, pick.c, true);
        }
      }
    }
  }

  computeBotInput(botIndex) {
    if (this.phase === 'setup') {
      if (!this.boards[botIndex].locked) return { action: 'lock' };
      return {};
    }
    if (this.phase === 'combat' && this.turn === botIndex && this.botThinkTimer <= 0) {
      const enemy = this.boards[botIndex === 0 ? 1 : 0];
      // Hunt near unsunk hits first
      const neighbors = [];
      const open = [];
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          if (enemy.incomingShots[r][c] === null || enemy.incomingShots[r][c] === 'shielded') {
            open.push({ r, c });
          } else if (enemy.incomingShots[r][c] === 'hit') {
            const ship = enemy.ships.find((s) => s.cells.some((x) => x.r === r && x.c === c));
            if (ship && !ship.sunk) {
              for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const rr = r + dr;
                const cc = c + dc;
                if (rr >= 0 && rr < GRID_SIZE && cc >= 0 && cc < GRID_SIZE) {
                  if (enemy.incomingShots[rr][cc] === null) neighbors.push({ r: rr, c: cc });
                }
              }
            }
          }
        }
      }
      const pool = neighbors.length > 0 ? neighbors : open;
      if (pool.length > 0) {
        const pick = pool[Math.floor(Math.random() * pool.length)];
        return { action: 'fire', ability: 'strike', r: pick.r, c: pick.c, horiz: true };
      }
    }
    return {};
  }

  getState(forPlayerIndex) {
    const viewer = forPlayerIndex === 0 || forPlayerIndex === 1 ? forPlayerIndex : 0;
    const enemy = viewer === 0 ? 1 : 0;
    const myBoard = this.boards[viewer];
    const enemyBoard = this.boards[enemy];

    // Never expose enemy unhit ship locations
    return {
      gameId: this.id,
      gridSize: GRID_SIZE,
      phase: this.phase,
      setupTimer: Math.ceil(this.setupTimer),
      turn: this.turn,
      turnTimer: Math.ceil(this.turnTimer),
      turnCount: this.turnCount,
      myIndex: viewer,
      locked: [this.boards[0].locked, this.boards[1].locked],
      cooldowns: myBoard.cooldowns,
      myShips: myBoard.ships,
      myShields: myBoard.shields,
      myIncomingShots: myBoard.incomingShots,
      enemyShots: enemyBoard.incomingShots,
      enemySunkShips: enemyBoard.ships.filter((s) => s.sunk),
      enemyShipsRemaining: enemyBoard.ships.filter((s) => !s.sunk).length,
      sonarMarks: myBoard.sonarMarks,
    };
  }
}
