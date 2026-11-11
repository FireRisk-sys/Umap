import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import {
  applyMapPatch,
  applyPlacementPatch,
  createDefaultGrid,
  createDefaultState,
  createDefaultVision,
  createPlacement,
  sanitizeState,
} from '../server/state.js';
import { TableHistory } from '../server/history.js';
import { startServer } from '../server/index.js';

function map(id = 'map') {
  return {
    id,
    name: id,
    url: `/library/maps/${id}.png`,
    width: 800,
    height: 600,
    createdAt: 1,
    grid: createDefaultGrid(800, 600),
    zones: [],
  };
}

function triangle() {
  return [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
}

test('default state has placements and legacy activeMapId migrates without changing it', () => {
  const defaults = createDefaultState();
  assert.deepEqual(defaults.placements, []);
  assert.equal(defaults.activePlacementId, null);

  const legacy = sanitizeState({ maps: [map()], activeMapId: 'map' });
  assert.equal(legacy.activeMapId, 'map');
  assert.equal(legacy.placements.length, 1);
  assert.equal(legacy.placements[0].mapId, 'map');
  assert.equal(legacy.placements[0].x, 0);
  assert.equal(legacy.placements[0].y, 0);
  assert.equal(legacy.placements[0].scale, 1);
  assert.equal(legacy.activePlacementId, legacy.placements[0].id);
  assert.deepEqual(legacy.maps[0].vision, createDefaultVision());
  assert.deepEqual(legacy.maps[0].walls, []);
});

test('sanitizeState filters placements and repairs activePlacementId', () => {
  const state = sanitizeState({
    maps: [map('one'), map('two')],
    activeMapId: 'one',
    activePlacementId: 'missing',
    placements: [
      { id: 'valid', mapId: 'two', x: -5, y: 8, scale: 20 },
      { id: 'bad-map', mapId: 'absent', x: 0, y: 0, scale: 1 },
      { id: 'bad-scale', mapId: 'one', x: 0, y: 0, scale: 21 },
      { id: 'bad-position', mapId: 'one', x: Number.NaN, y: 0, scale: 1 },
    ],
  });
  assert.deepEqual(state.placements, [{ id: 'valid', mapId: 'two', tableId: 'default', x: -5, y: 8, scale: 20 }]);
  assert.equal(state.activePlacementId, 'valid');
  assert.equal(state.activeMapId, 'one');
});

test('vision normalization clamps values and drops invalid walls', () => {
  const state = sanitizeState({
    maps: [{
      ...map(),
      vision: { enabled: 'yes', range: 1, rays: 20.6, opacity: 4, extra: true },
      walls: [
        { id: 'valid', name: 'Wall', points: triangle(), extra: 'drop' },
        { id: 'short', points: triangle().slice(0, 2) },
        { id: 'invalid', points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 1, y: 1 }] },
      ],
    }],
  });
  assert.deepEqual(state.maps[0].vision, { enabled: false, range: 10, rays: 24, opacity: 1 });
  assert.deepEqual(state.maps[0].walls, [{ id: 'valid', name: 'Wall', points: triangle() }]);

  const high = sanitizeState({ maps: [{ ...map(), vision: { range: 200_000, rays: 1000, opacity: -1 } }] });
  assert.deepEqual(high.maps[0].vision, { enabled: false, range: 100_000, rays: 720, opacity: 0 });
  const manyWalls = sanitizeState({ maps: [{ ...map(), walls: Array.from({ length: 501 }, () => ({ points: triangle() })) }] });
  assert.equal(manyWalls.maps[0].walls.length, 500);
});

test('applyMapPatch strictly validates vision and walls and strips arbitrary fields', () => {
  const updated = applyMapPatch(map(), {
    vision: { enabled: true, range: 1200, rays: 240, opacity: 0.5, unknown: true },
    walls: [{ id: 'wall', name: '  North  ', points: triangle(), color: 'red' }],
  });
  assert.deepEqual(updated.vision, { enabled: true, range: 1200, rays: 240, opacity: 0.5 });
  assert.deepEqual(updated.walls, [{ id: 'wall', name: 'North', points: triangle() }]);
  assert.throws(() => applyMapPatch(map(), { vision: { range: 9 } }));
  assert.throws(() => applyMapPatch(map(), { vision: { rays: 24.5 } }));
  assert.throws(() => applyMapPatch(map(), { vision: { opacity: 2 } }));
  assert.throws(() => applyMapPatch(map(), { walls: [{ points: triangle().slice(0, 2) }] }));
  assert.throws(() => applyMapPatch(map(), { walls: [{ points: Array.from({ length: 201 }, () => ({ x: 0, y: 0 })) }] }));
});

test('placement helpers validate coordinates and scale', () => {
  const state = createDefaultState();
  state.maps = [map()];
  const placement = createPlacement(state, { mapId: 'map' });
  assert.equal(placement.x, 0);
  assert.equal(placement.scale, 1);
  const updated = applyPlacementPatch(placement, { x: 10, y: -20, scale: 0.05, mapId: 'other' });
  assert.deepEqual(updated, { id: placement.id, mapId: 'map', tableId: 'default', x: 10, y: -20, scale: 0.05 });
  assert.throws(() => createPlacement(state, { mapId: 'map', scale: 0.01 }));
  assert.throws(() => applyPlacementPatch(placement, { x: Infinity }));
});

test('history restores placements and activePlacementId', () => {
  const history = new TableHistory();
  const before = createDefaultState();
  before.maps = [map()];
  before.placements = [{ id: 'first', mapId: 'map', x: 0, y: 0, scale: 1 }];
  before.activePlacementId = 'first';
  history.record(before, 'Перемещение карты');
  const after = {
    ...before,
    placements: [{ id: 'second', mapId: 'map', x: 50, y: 60, scale: 2 }],
    activePlacementId: 'second',
  };
  const undone = history.undo(after).state;
  assert.deepEqual(undone.placements, before.placements);
  assert.equal(undone.activePlacementId, 'first');
  const redone = history.redo(undone).state;
  assert.deepEqual(redone.placements, after.placements);
  assert.equal(redone.activePlacementId, 'second');
});

class HostClient {
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
        reject(new Error('Timed out waiting for placement message'));
      }, timeout);
      this.waiters.add(waiter);
    });
  }
}

test('placement WebSocket commands update state and deleteMap cleans placements', { timeout: 15_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'umap-placements-'));
  let instance;
  let socket;
  try {
    instance = await startServer({ port: 0, dev: false, dataDir: path.join(root, 'data'), libraryDir: path.join(root, 'library') });
    await Promise.all([
      writeFile(path.join(root, 'library', 'maps', 'one.png'), 'one'),
      writeFile(path.join(root, 'library', 'maps', 'two.png'), 'two'),
    ]);
    const importMap = async (fileName) => {
      const response = await fetch(`http://127.0.0.1:${instance.port}/api/library/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client-id': instance.hostKey },
        body: JSON.stringify({ kind: 'map', fileName }),
      });
      assert.equal(response.status, 201);
      return (await response.json()).item;
    };
    const firstMap = await importMap('one.png');
    const secondMap = await importMap('two.png');

    socket = new WebSocket(`ws://127.0.0.1:${instance.port}`);
    const client = new HostClient(socket);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    client.send({ type: 'hello', hostKey: instance.hostKey });
    await client.wait((message) => message.type === 'welcome');

    client.send({ type: 'placeMap', mapId: firstMap.id, x: 10, y: 20, scale: 2 });
    const placed = await client.wait((message) => message.type === 'state' && message.state.placements.length === 1);
    const firstPlacement = placed.state.placements[0];
    assert.equal(placed.state.activePlacementId, firstPlacement.id);
    assert.equal(placed.history.items.at(-1).label, 'Добавление карты на стол');

    client.send({ type: 'placeMap', mapId: secondMap.id });
    const secondPlaced = await client.wait((message) => message.type === 'state' && message.state.placements.length === 2);
    const secondPlacement = secondPlaced.state.placements[1];
    client.send({ type: 'updatePlacement', id: secondPlacement.id, patch: { x: 40, scale: 1.5 } });
    await client.wait((message) => message.type === 'state' && message.state.placements[1]?.x === 40);

    client.send({ type: 'selectPlacement', placementId: firstPlacement.id });
    await client.wait((message) => message.type === 'state' && message.state.activePlacementId === firstPlacement.id);
    client.send({ type: 'removePlacement', id: firstPlacement.id });
    const removed = await client.wait((message) => message.type === 'state' && message.state.placements.length === 1);
    assert.equal(removed.state.activePlacementId, secondPlacement.id);
    assert.equal(removed.history.items.at(-1).label, 'Удаление карты со стола');

    client.send({ type: 'deleteMap', mapId: secondMap.id });
    const deleted = await client.wait((message) => message.type === 'state' && message.state.maps.length === 1);
    assert.deepEqual(deleted.state.placements, []);
    assert.equal(deleted.state.activePlacementId, null);
    assert.equal(deleted.state.maps[0].id, firstMap.id);
  } finally {
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      const closed = new Promise((resolve) => socket.once('close', resolve));
      socket.close();
      await closed;
    }
    if (instance) await instance.close();
    await rm(root, { recursive: true, force: true });
  }
});
