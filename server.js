import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room, newCode } from './room.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = process.env.PORT ?? 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const rooms = new Map();
const sessions = new Map(); // token -> { room, member }

function createRoom() {
  let code;
  do {
    code = newCode();
  } while (rooms.has(code));

  const room = new Room(code);
  room.emit = () => {
    for (const member of room.members) {
      const open = streams.get(member.token);
      if (!open?.size) continue;
      const frame = `event: state\ndata: ${JSON.stringify(room.snapshot(member))}\n\n`;
      for (const res of open) res.write(frame);
    }
  };

  rooms.set(code, room);
  return room;
}

const streams = new Map(); // token -> Set<ServerResponse>

function openStream(token, res) {
  const session = sessions.get(token);
  if (!session) return false;

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  let set = streams.get(token);
  if (!set) streams.set(token, (set = new Set()));
  set.add(res);

  res.write(`event: state\ndata: ${JSON.stringify(session.room.snapshot(session.member))}\n\n`);
  res.on('close', () => {
    set.delete(res);
    if (!set.size) streams.delete(token);
  });
  return true;
}

setInterval(() => {
  for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
}, 25_000).unref();

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) throw new Error('Message too long');
  }
  return JSON.parse(raw || '{}');
}

async function api(req, res) {
  const { token, name, room: code, bots, move, text, rules } = await readBody(req);
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/join') {
    let room;
    if (code) {
      room = rooms.get(String(code).toUpperCase());
      if (!room) return json(res, 404, { error: 'No room with that code' });
    } else {
      room = createRoom();
    }

    const member = room.join(name);
    sessions.set(member.token, { room, member });
    return json(res, 200, { room: room.code, token: member.token });
  }

  const session = sessions.get(token);
  if (!session) return json(res, 401, { error: 'Join the room first' });

  if (pathname === '/api/start') session.room.start(session.member, Number(bots) || 0);
  else if (pathname === '/api/rules') session.room.setRules(session.member, rules);
  else if (pathname === '/api/move') session.room.act(session.member, move ?? {});
  else if (pathname === '/api/chat') session.room.say(session.member, text);
  else return json(res, 404, { error: 'Unknown call' });

  json(res, 200, { ok: true });
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  try {
    if (url.pathname === '/api/stream' && req.method === 'GET') {
      if (!openStream(url.searchParams.get('token'), res)) json(res, 401, { error: 'Join the room first' });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
      await api(req, res);
      return;
    }

    const file = normalize(join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
    if (!file.startsWith(ROOT + sep)) return json(res, 403, { error: 'Nope' });

    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    if (!res.headersSent) json(res, 400, { error: err.message });
    else res.end();
  }
}).listen(PORT, () => {
  console.log(`\n  UNO but Browser  ->  http://localhost:${PORT}`);
  for (const net of Object.values(networkInterfaces()).flat()) {
    if (net?.family === 'IPv4' && !net.internal) console.log(`  On your network  ->  http://${net.address}:${PORT}`);
  }
  console.log('');
});
