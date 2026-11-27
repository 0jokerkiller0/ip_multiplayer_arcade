import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './RoomManager.js';
import { getPublicCatalog } from './games/registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const THREE_FILE = path.join(ROOT_DIR, 'node_modules', 'three', 'build', 'three.module.min.js');

const PORT = Number(process.env.PORT) || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const urls = [];
  const scoreInterface = (name, addr) => {
    const low = name.toLowerCase();
    if (low.includes('wi-fi') || low.includes('wifi') || low.includes('wlan')) return 0;
    if (low.includes('vethernet') || low.includes('wsl') || low.includes('virtual') || low.includes('vmware')) return 3;
    if (addr.startsWith('192.168.56.') || addr.startsWith('192.168.153.') || addr.startsWith('192.168.231.')) return 3;
    if (low.includes('ethernet')) return 1;
    return 2;
  };
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        urls.push({ interface: name, address: iface.address, rank: scoreInterface(name, iface.address) });
      }
    }
  }
  urls.sort((a, b) => a.rank - b.rank);
  return urls;
}

export function createArcadeServer() {
  const roomManager = new RoomManager();

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = reqUrl.pathname;

    if (pathname === '/api/info') {
      const lan = getLanAddresses();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          port: PORT,
          lanUrls: lan.map((l) => `http://${l.address}:${PORT}`),
          catalog: getPublicCatalog(),
        })
      );
      return;
    }

    if (pathname === '/vendor/three.module.min.js') {
      fs.readFile(THREE_FILE, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Three.js bundle not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        res.end(data);
      });
      return;
    }

    const safePath = pathname === '/' ? '/index.html' : pathname;
    const resolved = path.normalize(path.join(PUBLIC_DIR, safePath));
    if (!resolved.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(resolved, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (socket, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const roomCode = url.searchParams.get('room') || 'ARENA';
    const name = url.searchParams.get('name') || '';
    const sessionId = url.searchParams.get('sid') || '';

    roomManager.joinRoom(socket, { roomCode, name, sessionId });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        roomManager.handleMessage(socket, msg);
      } catch {
        // Ignore malformed packets
      }
    });

    socket.on('close', () => {
      roomManager.handleDisconnect(socket);
    });
  });

  return { server, wss, roomManager };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const { server } = createArcadeServer();
  server.listen(PORT, '0.0.0.0', () => {
    const lan = getLanAddresses();
    console.log('\n======================================================');
    console.log('  NEXUS ARCADE // 2-Player IP Multiplayer 3D Hub');
    console.log('======================================================');
    console.log(`  Local PC:   http://localhost:${PORT}`);
    if (lan.length > 0) {
      for (const item of lan) {
        console.log(`  LAN Share:  http://${item.address}:${PORT}  (${item.interface})`);
      }
    } else {
      console.log('  LAN Share:  Check your IPv4 with ipconfig');
    }
    console.log('  Share any LAN URL with Player 2 on the same Wi-Fi!');
    console.log('======================================================\n');
  });
}
