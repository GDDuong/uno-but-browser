import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { isPlayable } from '../public/game/rules.js';

const PORT = 3123;
const BASE = `http://localhost:${PORT}`;

// process.execPath is the Electron binary under some runners, so keep ELECTRON_RUN_AS_NODE for those.
const server = spawn(process.execPath, ['server.js'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

server.on('error', (err) => console.error('spawn failed:', err.message));

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server never came up');
}

async function post(path, data) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json() };
}

async function openStream(token) {
  const res = await fetch(`${BASE}/api/stream?token=${token}`);
  const reader = res.body.getReader();
  const decode = new TextDecoder();
  let buffer = '';

  const next = async () => {
    for (;;) {
      const frames = buffer.split('\n\n');
      buffer = frames.pop();
      for (const frame of frames) {
        const lines = frame.split('\n');
        if (!lines.some((line) => line === 'event: state')) continue;
        const data = lines.find((line) => line.startsWith('data: '));
        if (data) return JSON.parse(data.slice(6));
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('Table stream closed');
      buffer += decode.decode(value, { stream: true });
    }
  };

  return { next, until: async (pred) => until(next, pred), close: () => reader.cancel() };
}

const until = (next, pred) =>
  (async () => {
    for (;;) {
      const state = await next();
      if (pred(state)) return state;
    }
  })();

test('table: two browsers join, play, and never see each others hands', async () => {
  await waitReady();

  const ana = (await post('/api/join', { name: 'Ana' })).body;
  assert.match(ana.room, /^[A-Z]{4}$/);

  const bo = (await post('/api/join', { name: 'Bo', room: ana.room })).body;
  assert.equal(bo.room, ana.room);

  const anaStream = await openStream(ana.token);
  const boStream = await openStream(bo.token);

  const lobby = await anaStream.until((s) => s.seats.length === 2);
  assert.equal(lobby.game, null);
  assert.deepEqual(lobby.seats.map((m) => m.name), ['Ana', 'Bo']);

  const started = await post('/api/start', { token: ana.token, bots: 0 });
  assert.equal(started.status, 200);

  const dealt = await boStream.until((s) => s.game);
  assert.equal(dealt.game.players.length, 2);
  assert.equal(dealt.game.players[0].hand.length, 0, 'opponent hand must stay hidden');
  assert.equal(dealt.game.players[0].handCount, 7);
  assert.equal(dealt.game.players[1].hand.length, 7);
  assert.equal(dealt.game.deck.length, 0);
  assert.ok(dealt.game.deckCount > 0);

  const wrongSeat = await post('/api/move', { token: bo.token, move: { type: 'draw' } });
  assert.equal(wrongSeat.status, 400);
  assert.match(wrongSeat.body.error, /Not your turn/);

  await post('/api/chat', { token: bo.token, text: '<script>hi</script>' });
  const withChat = await anaStream.until((s) => s.chat.length);
  assert.equal(withChat.chat[0].from, 'Bo');
  assert.match(withChat.chat[0].text, /hi/);

  const drew = await post('/api/move', { token: ana.token, move: { type: 'draw' } });
  assert.equal(drew.status, 200);

  const moved = await boStream.until((s) => s.log[0]?.includes('Ana drew'));
  assert.equal(moved.game.players[0].handCount, 8);

  const hijack = await post('/api/move', { token: 'not-a-token', move: { type: 'draw' } });
  assert.equal(hijack.status, 401);

  await anaStream.close();
  await boStream.close();
});

test('table: a full two player game runs to a win', async () => {
  await waitReady();

  const anna = (await post('/api/join', { name: 'Anna' })).body;
  const bram = (await post('/api/join', { name: 'Bram', room: anna.room })).body;
  const sides = [];

  for (const [seat, client] of [[0, anna], [1, bram]]) {
    const stream = await openStream(client.token);
    const box = { seat, token: client.token, state: null, stream };
    (async () => {
      try {
        for (;;) box.state = await stream.next();
      } catch {
        // the table closed under us
      }
    })();
    sides.push(box);
  }

  assert.equal((await post('/api/start', { token: anna.token, bots: 0 })).status, 200);

  for (let guard = 2000; guard > 0; guard--) {
    const game = sides[0].state?.game;
    if (game?.phase === 'over') break;

    const mover = sides.find((s) => s.state?.game?.current === s.seat && s.state.game.phase === 'playing');
    if (mover) {
      const played = await post('/api/move', { token: mover.token, move: pickMove(mover.state.game) });
      assert.equal(played.status, 200, JSON.stringify(played.body));
    }
    await new Promise((r) => setTimeout(r, 5));
  }

  const over = sides[0].state;
  assert.equal(over.game.phase, 'over');
  assert.match(over.log[0], /wins by playing/);
  assert.equal(over.game.players[over.game.winner].handCount ?? over.game.players[over.game.winner].hand.length, 0);

  await Promise.all(sides.map((s) => s.stream.close()));
});

function pickMove(game) {
  const hand = game.players[game.current].hand;

  if (game.pending) {
    const drawn = hand.find((card) => card.id === game.pending.cardId);
    return drawn ? { type: 'play', cardId: drawn.id, color: 'red' } : { type: 'pass' };
  }

  const plays = hand.filter((card) => isPlayable(game, card));
  if (!plays.length) return { type: 'draw' };

  const move = { type: 'play', cardId: plays[0].id };
  if (plays[0].color === 'wild') move.color = 'red';
  return move;
}

test.after(() => server.kill());
