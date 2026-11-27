import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createArcadeServer } from '../server/index.js';

function connectClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue = [];
    const waiters = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (waiters.length > 0) {
        const idx = waiters.findIndex((w) => w.pred(msg));
        if (idx !== -1) {
          const [w] = waiters.splice(idx, 1);
          w.resolve(msg);
          return;
        }
      }
      queue.push(msg);
    });

    ws.nextMsg = (pred = () => true, timeoutMs = 4000) => {
      const qIdx = queue.findIndex(pred);
      if (qIdx !== -1) {
        return Promise.resolve(queue.splice(qIdx, 1)[0]);
      }
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('Timed out waiting for WS message')), timeoutMs);
        waiters.push({
          pred,
          resolve: (m) => {
            clearTimeout(timer);
            res(m);
          },
        });
      });
    };

    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

test('HTTP /api/info, Three.js vendor bundle, and 2-player WebSocket match flow', async () => {
  const { server } = createArcadeServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  try {
    const infoRes = await fetch(`http://127.0.0.1:${port}/api/info`);
    assert.equal(infoRes.status, 200);
    const info = await infoRes.json();
    assert.equal(info.catalog.length, 5);

    const threeRes = await fetch(`http://127.0.0.1:${port}/vendor/three.module.min.js`);
    assert.equal(threeRes.status, 200);

    const p1 = await connectClient(`ws://127.0.0.1:${port}?room=TEST1&name=Alpha&sid=s1`);
    const w1 = await p1.nextMsg((m) => m.type === 'welcome');
    assert.equal(w1.playerIndex, 0);

    const p2 = await connectClient(`ws://127.0.0.1:${port}?room=TEST1&name=Bravo&sid=s2`);
    const w2 = await p2.nextMsg((m) => m.type === 'welcome');
    assert.equal(w2.playerIndex, 1);

    // Select Air Hockey and ready both players
    p1.send(JSON.stringify({ type: 'select_game', gameId: 'air_hockey' }));
    p1.send(JSON.stringify({ type: 'ready', ready: true }));
    p2.send(JSON.stringify({ type: 'ready', ready: true }));

    const countdownRoom = await p1.nextMsg((m) => m.type === 'room' && m.status === 'countdown');
    assert.equal(countdownRoom.selectedGameId, 'air_hockey');

    // Wait for playing state snapshot
    const stateMsg = await p1.nextMsg((m) => m.type === 'state' && m.state?.gameId === 'air_hockey', 5000);
    assert.equal(stateMsg.state.paddles.length, 2);

    p1.close();
    p2.close();
  } finally {
    await new Promise((r) => server.close(r));
  }
});
