// The Art of Touge: multiplayer relay server.
//
// Players connect over WebSocket, join the room for the road they are on, and the server passes
// each player's car state on to everyone else in that room. It does no physics: every game
// simulates its own car and draws the others where they say they are.
//
//   npm install && npm start            (listens on port 8080, or $PORT)
//
// Environment: PORT, SERVER_NAME (shown to players), MAX_PLAYERS (per room, default 12).
//
// Messages are JSON. Client -> server:
//   { t: 'hello', name, road, look }    join (or switch to) a road's room
//   { t: 'state', s: [...] }            car state, sent ~15 times a second
//   { t: 'look', look }                 the car's paint, wheels and so on changed
//   { t: 'chat', text }                 a short message
// Server -> client:
//   { t: 'welcome', id, server, players: [{ id, name, look }] }
//   { t: 'join', id, name, look }  { t: 'leave', id }  { t: 'look', id, look }
//   { t: 'state', id, s }          { t: 'chat', id, name, text }  { t: 'full' }

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8080;
const SERVER_NAME = (process.env.SERVER_NAME || 'Touge server').slice(0, 40);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 12;
const ROADS = new Set(['akina', 'dragon']);

const rooms = new Map(); // road -> Set of clients
let nextId = 1;

const clean = (text, n) => String(text ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').slice(0, n).trim();
const safeLook = (look) => {
  // Only pass on small plain objects (paint, wheels, plate and so on).
  if (!look || typeof look !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(look).slice(0, 40)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 24);
  }
  return out;
};

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, except) {
  const data = JSON.stringify(msg);
  for (const c of room) if (c !== except && c.readyState === 1) c.send(data);
}

function leave(ws) {
  if (!ws.road) return;
  const room = rooms.get(ws.road);
  room?.delete(ws);
  if (room) broadcast(room, { t: 'leave', id: ws.id });
  ws.road = null;
}

const http = createServer((req, res) => {
  // A plain status page, handy for checking the server is up.
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  const counts = Object.fromEntries([...rooms].map(([k, v]) => [k, v.size]));
  res.end(JSON.stringify({ server: SERVER_NAME, players: counts }));
});

const wss = new WebSocketServer({ server: http, maxPayload: 4096 });

wss.on('connection', (ws) => {
  ws.id = nextId++;
  ws.road = null;
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      const road = ROADS.has(msg.road) ? msg.road : 'akina';
      leave(ws);
      if (!rooms.has(road)) rooms.set(road, new Set());
      const room = rooms.get(road);
      if (room.size >= MAX_PLAYERS) {
        send(ws, { t: 'full' });
        return;
      }
      ws.name = clean(msg.name, 16) || `Driver ${ws.id}`;
      ws.look = safeLook(msg.look);
      ws.road = road;
      send(ws, { t: 'welcome', id: ws.id, server: SERVER_NAME, players: [...room].map((c) => ({ id: c.id, name: c.name, look: c.look })) });
      room.add(ws);
      broadcast(room, { t: 'join', id: ws.id, name: ws.name, look: ws.look }, ws);
    } else if (!ws.road) {
      return;
    } else if (msg.t === 'state' && Array.isArray(msg.s) && msg.s.length <= 16) {
      broadcast(rooms.get(ws.road), { t: 'state', id: ws.id, s: msg.s.map((v) => (typeof v === 'number' ? v : 0)) }, ws);
    } else if (msg.t === 'look') {
      ws.look = safeLook(msg.look);
      broadcast(rooms.get(ws.road), { t: 'look', id: ws.id, look: ws.look }, ws);
    } else if (msg.t === 'chat') {
      const text = clean(msg.text, 80);
      if (text) broadcast(rooms.get(ws.road), { t: 'chat', id: ws.id, name: ws.name, text });
    }
  });
  ws.on('close', () => leave(ws));
});

// Drop connections that stop answering.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 15000);

http.listen(PORT, () => console.log(`${SERVER_NAME} listening on port ${PORT}`));
