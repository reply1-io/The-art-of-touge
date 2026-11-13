// Play online with no server to set up. One player HOSTS: their game becomes the room, gets a
// five-character code, and passes everyone's car state along (exactly like server/server.js does).
// Friends JOIN with the code. PeerJS's free public service only introduces the phones to each
// other; after that the game data goes straight between them.
//
// Both kinds of connection are wrapped as a "link": { send(msg), close(), onopen, onmessage,
// onclose, onerror }, the same shape the Online client uses for a WebSocket server.
import Peer from 'peerjs';

const PREFIX = 'bwtouge-room-';
const MAX_PLAYERS = 8;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to mix up

export function makeCode() {
  let c = '';
  for (let i = 0; i < 5; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return c;
}

export function cleanCode(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
}

// Signalling: PeerJS's public service, or one given as ?signal=host:port (for testing).
function peerOptions() {
  const sig = new URLSearchParams(location.search).get('signal');
  if (!sig) return { debug: 0 };
  const [host, port] = sig.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false, debug: 0 };
}

const errorText = (e) =>
  e?.type === 'peer-unavailable'
    ? 'No game with that code'
    : e?.type === 'unavailable-id'
      ? 'That code is busy, try again'
      : e?.type === 'network' || e?.type === 'server-error' || e?.type === 'socket-error'
        ? 'Could not reach the matchmaking service'
        : 'Could not connect';

// ---------- Hosting ----------
export class HostRoom {
  // settings: { name, road, time }
  constructor(code, settings) {
    this.code = code;
    this.settings = { ...settings };
    this.clients = new Set();
    this.nextId = 1;
    this.onOpen = () => {};
    this.onError = () => {};
    this.peer = new Peer(PREFIX + code, peerOptions());
    this.peer.on('open', () => this.onOpen());
    this.peer.on('error', (e) => this.onError(errorText(e), e));
    this.peer.on('connection', (conn) => {
      const client = { conn, send: (m) => conn.open && conn.send(m) };
      conn.on('open', () => this.clients.add(client));
      conn.on('data', (m) => this.#receive(client, m));
      conn.on('close', () => this.#leave(client));
      conn.on('error', () => this.#leave(client));
    });
  }

  get count() {
    let n = 0;
    for (const c of this.clients) if (c.id) n++;
    return n;
  }

  // The host's own game talks to the room through this in-memory link.
  localLink() {
    const link = { onopen: null, onmessage: null, onclose: null, onerror: null };
    const client = { local: true, send: (m) => queueMicrotask(() => link.onmessage?.(m)) };
    this.clients.add(client);
    link.send = (m) => this.#receive(client, m);
    link.close = () => this.close();
    queueMicrotask(() => link.onopen?.());
    return link;
  }

  // Change the road or time for everyone in the room.
  setSettings(patch) {
    Object.assign(this.settings, patch);
    this.#broadcast({ t: 'room', room: this.#room() });
  }

  close() {
    for (const c of this.clients) if (!c.local) c.conn.close();
    this.clients.clear();
    this.peer.destroy();
  }

  #room() {
    return { code: this.code, road: this.settings.road, time: this.settings.time };
  }

  #broadcast(msg, except) {
    for (const c of this.clients) if (c !== except && c.id) c.send(msg);
  }

  #receive(c, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (!c.id && this.count >= MAX_PLAYERS) {
        c.send({ t: 'full' });
        return;
      }
      c.id ??= this.nextId++;
      c.name = String(m.name || '').slice(0, 16) || `Driver ${c.id}`;
      c.look = m.look && typeof m.look === 'object' ? m.look : {};
      const players = [...this.clients].filter((o) => o !== c && o.id).map((o) => ({ id: o.id, name: o.name, look: o.look }));
      c.send({ t: 'welcome', id: c.id, server: `${this.settings.name}'s room`, room: this.#room(), players });
      this.#broadcast({ t: 'join', id: c.id, name: c.name, look: c.look }, c);
    } else if (!c.id) {
      return;
    } else if (m.t === 'state' && Array.isArray(m.s)) {
      this.#broadcast({ t: 'state', id: c.id, s: m.s }, c);
    } else if (m.t === 'look') {
      c.look = m.look || {};
      this.#broadcast({ t: 'look', id: c.id, look: c.look }, c);
    } else if (m.t === 'chat') {
      const text = String(m.text || '').slice(0, 80);
      if (text) this.#broadcast({ t: 'chat', id: c.id, name: c.name, text });
    }
  }

  #leave(c) {
    if (!this.clients.delete(c)) return;
    if (c.id) this.#broadcast({ t: 'leave', id: c.id });
  }
}

// ---------- Joining ----------
export function joinLink(code) {
  const link = { onopen: null, onmessage: null, onclose: null, onerror: null };
  let conn = null;
  let peer;
  try {
    peer = new Peer(undefined, peerOptions());
  } catch {
    queueMicrotask(() => link.onerror?.('Could not connect'));
    link.send = () => {};
    link.close = () => {};
    return link;
  }
  peer.on('open', () => {
    conn = peer.connect(PREFIX + cleanCode(code), { reliable: true });
    conn.on('open', () => link.onopen?.());
    conn.on('data', (m) => link.onmessage?.(m));
    conn.on('close', () => link.onclose?.());
    conn.on('error', (e) => link.onerror?.(errorText(e)));
  });
  peer.on('error', (e) => link.onerror?.(errorText(e)));
  link.send = (m) => conn?.open && conn.send(m);
  link.close = () => peer.destroy();
  return link;
}

// ---------- Own server (server/server.js over WebSocket) ----------
export function serverLink(url) {
  const link = { onopen: null, onmessage: null, onclose: null, onerror: null };
  let addr = url.trim();
  if (!/^wss?:\/\//.test(addr)) addr = (location.protocol === 'https:' ? 'wss://' : 'ws://') + addr;
  let ws;
  try {
    ws = new WebSocket(addr);
  } catch {
    queueMicrotask(() => link.onerror?.('Could not connect'));
    link.send = () => {};
    link.close = () => {};
    return link;
  }
  ws.onopen = () => link.onopen?.();
  ws.onmessage = (e) => {
    try {
      link.onmessage?.(JSON.parse(e.data));
    } catch {
      // Ignore anything that is not our JSON.
    }
  };
  ws.onerror = () => link.onerror?.(location.protocol === 'https:' && addr.startsWith('ws://') ? 'This page needs a wss:// server' : 'Could not connect');
  ws.onclose = () => link.onclose?.();
  link.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  link.close = () => ws.close();
  return link;
}
