import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import {
  clearDrawings,
  createBlankMap,
  createDrawing,
  publicState,
  removeExpiredDrawings,
  sanitizeState,
  undoDrawing,
} from '../server/state.js';
import { startServer } from '../server/index.js';

const points = [{ x: 0, y: 0 }, { x: 10, y: 20 }];
const stroke = { color: '#A1b2C3', width: 4, opacity: 0.7, points };

function drawingState() {
  const map = createBlankMap({ name: 'Map', width: 800, height: 600, color: '#ffffff' });
  const host = createDrawing(stroke, { role: 'host' }, 1000);
  const player = createDrawing(stroke, { role: 'player', playerId: 'player', playerName: 'Alice' }, 2000);
  map.drawings = [host, player];
  return { map, host, player };
}

test('createBlankMap validates input and creates an SVG map with defaults', () => {
  const map = createBlankMap({ name: '  Blank  ', width: 640, height: 480, color: '#A1b2C3' });
  assert.equal(map.name, 'Blank');
  assert.equal(map.grid.bounds.width, 640);
  assert.equal(map.grid.bounds.height, 480);
  assert.deepEqual(map.drawings, []);
  assert.deepEqual(map.walls, []);
  assert.equal(map.vision.enabled, false);
  const svg = decodeURIComponent(map.url.slice('data:image/svg+xml;charset=utf-8,'.length));
  assert.match(svg, /<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="640" height="480"/);
  assert.match(svg, /fill="#A1b2C3"/);

  assert.throws(() => createBlankMap({ name: '', width: 640, height: 480, color: '#ffffff' }));
  assert.throws(() => createBlankMap({ name: 'x'.repeat(61), width: 640, height: 480, color: '#ffffff' }));
  assert.throws(() => createBlankMap({ name: 'Map', width: 640.5, height: 480, color: '#ffffff' }));
  assert.throws(() => createBlankMap({ name: 'Map', width: 199, height: 480, color: '#ffffff' }));
  assert.throws(() => createBlankMap({ name: 'Map', width: 640, height: 480, color: 'white' }));
});

test('drawing sanitization and publicState expire only old nonpersistent strokes without mutation', () => {
  const { map, host, player } = drawingState();
  map.drawings = [
    { ...player, id: 'expired', createdAt: 1000, persistent: false },
    { ...player, id: 'boundary', createdAt: 5000, persistent: false },
    { ...host, id: 'persistent', createdAt: 1000, persistent: true },
    { ...player, id: 'invalid', color: 'red' },
  ];
  const state = sanitizeState({ maps: [map] });
  assert.deepEqual(state.maps[0].drawings.map((drawing) => drawing.id), ['expired', 'boundary', 'persistent']);

  const visible = publicState(state, 20_000);
  assert.deepEqual(visible.maps[0].drawings.map((drawing) => drawing.id), ['boundary', 'persistent']);
  assert.equal(state.maps[0].drawings.length, 3, 'publicState does not mutate source state');
  const cleaned = removeExpiredDrawings(state, 20_000);
  assert.deepEqual(cleaned.maps[0].drawings.map((drawing) => drawing.id), ['boundary', 'persistent']);
  assert.equal(state.maps[0].drawings.length, 3);
  assert.equal(removeExpiredDrawings(cleaned, 20_000), cleaned);
});

test('drawing ownership, clear and undo operate on the current actor strokes', () => {
  const { map, host, player } = drawingState();
  const secondHost = { ...host, id: 'host-2' };
  const secondPlayer = { ...player, id: 'player-2' };
  map.drawings = [host, player, secondHost, secondPlayer];
  const state = { maps: [map] };
  const playerActor = { role: 'player', playerId: 'player', playerName: 'Alice' };
  const hostActor = { role: 'host' };

  assert.equal(host.persistent, true);
  assert.equal(host.ownerId, 'host');
  assert.equal(host.ownerName, 'GM');
  assert.equal(player.persistent, false);
  assert.equal(player.ownerId, 'player');
  assert.equal(player.ownerName, 'Alice');
  assert.throws(() => clearDrawings(state, map.id, playerActor, host.id));

  const undonePlayer = undoDrawing(state, map.id, playerActor);
  assert.deepEqual(undonePlayer.maps[0].drawings.map((drawing) => drawing.id), [host.id, player.id, secondHost.id]);
  const undoneHost = undoDrawing(undonePlayer, map.id, hostActor);
  assert.deepEqual(undoneHost.maps[0].drawings.map((drawing) => drawing.id), [host.id, player.id]);
  const clearedPlayer = clearDrawings(state, map.id, playerActor);
  assert.deepEqual(clearedPlayer.maps[0].drawings.map((drawing) => drawing.id), [host.id, secondHost.id]);
  const clearedByHost = clearDrawings(state, map.id, hostActor, player.id);
  assert.deepEqual(clearedByHost.maps[0].drawings.map((drawing) => drawing.id), [host.id, secondHost.id, secondPlayer.id]);
  assert.deepEqual(clearDrawings(state, map.id, hostActor).maps[0].drawings, []);
});

class Client {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.waiters = new Set();
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      for (const waiter of this.waiters) {
        if (!waiter.predicate(message)) continue;
        this.waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
      this.messages.push(message);
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  wait(predicate, timeout = 4000) {
    const index = this.messages.findIndex(predicate);
    if (index !== -1) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error('Timed out waiting for drawing message'));
      }, timeout);
      this.waiters.add(waiter);
    });
  }
}

test('blank map and drawing WebSocket commands preserve ownership', { timeout: 15_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'umap-drawings-'));
  let instance;
  const sockets = [];
  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${instance.port}`);
    sockets.push(socket);
    const client = new Client(socket);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return client;
  };

  try {
    instance = await startServer({ port: 0, dev: false, dataDir: path.join(root, 'data'), libraryDir: path.join(root, 'library') });
    const host = await connect();
    host.send({ type: 'hello', hostKey: instance.hostKey });
    await host.wait((message) => message.type === 'welcome');
    const player = await connect();
    player.send({ type: 'hello', name: 'Alice' });
    const pending = await player.wait((message) => message.type === 'pending');
    host.send({ type: 'approvePlayer', playerId: pending.playerId });
    await player.wait((message) => message.type === 'welcome');

    host.send({ type: 'createBlankMap', name: 'Blank', width: 800, height: 600, color: '#112233' });
    const created = await host.wait((message) => message.type === 'state' && message.state.maps.length === 1);
    const map = created.state.maps[0];
    assert.equal(created.state.placements[0].mapId, map.id);
    assert.equal(created.state.placements[0].tableId, created.state.activeTableId);
    assert.equal(created.state.activePlacementId, created.state.placements[0].id);

    player.send({ type: 'drawing:add', mapId: map.id, stroke });
    const playerStroke = await host.wait((message) => message.type === 'state' && message.state.maps[0]?.drawings.length === 1);
    assert.equal(playerStroke.state.maps[0].drawings[0].ownerId, pending.playerId);
    assert.equal(playerStroke.state.maps[0].drawings[0].persistent, false);

    host.send({ type: 'drawing:add', mapId: map.id, stroke });
    const bothStrokes = await host.wait((message) => message.type === 'state' && message.state.maps[0]?.drawings.length === 2);
    const hostStroke = bothStrokes.state.maps[0].drawings[1];
    assert.equal(hostStroke.ownerId, 'host');
    assert.equal(hostStroke.persistent, true);

    player.send({ type: 'drawing:undo', mapId: map.id });
    await host.wait((message) => message.type === 'state' && message.state.maps[0]?.drawings.length === 1);
    player.send({ type: 'drawing:clear', mapId: map.id, strokeId: hostStroke.id });
    const error = await player.wait((message) => message.type === 'error');
    assert.match(error.message, /own drawings/);

    player.send({ type: 'drawing:add', mapId: map.id, stroke });
    await host.wait((message) => message.type === 'state' && message.state.maps[0]?.drawings.length === 2);
    player.send({ type: 'drawing:clear', mapId: map.id });
    const cleared = await host.wait((message) => message.type === 'state' && message.state.maps[0]?.drawings.length === 1);
    assert.equal(cleared.state.maps[0].drawings[0].ownerId, 'host');
    host.send({ type: 'drawing:undo', mapId: map.id });
    const undone = await host.wait((message) => message.type === 'state' && message.state.maps[0]?.drawings.length === 0);
    assert.equal(undone.history.items.at(-1).label, 'Отмена рисунка');
  } finally {
    await Promise.all(sockets.filter((socket) => socket.readyState !== WebSocket.CLOSED).map((socket) => {
      const closed = new Promise((resolve) => socket.once('close', resolve));
      socket.close();
      return closed;
    }));
    if (instance) await instance.close();
    await rm(root, { recursive: true, force: true });
  }
});
