import test from 'node:test';
import assert from 'node:assert/strict';
import { TableHistory, createTableSnapshot } from '../server/history.js';
import {
  applyMapPatch,
  createDefaultGrid,
  createDefaultState,
  removeEntity,
  sanitizeState,
} from '../server/state.js';

function tableState() {
  const state = createDefaultState();
  state.players = [{ id: 'player', name: 'Alice', connected: true }];
  state.assets = [{ id: 'asset', kind: 'token', name: 'Hero', url: '/uploads/hero.png', width: 100, height: 100, createdAt: 1 }];
  state.entities = [{ id: 'token', assetId: 'asset', kind: 'token', name: 'Hero', x: 10, y: 20, size: 80, rotation: 0, ownerId: 'player' }];
  state.maps = [{ id: 'map', name: 'Map', url: '/uploads/map.png', width: 800, height: 600, createdAt: 1, grid: createDefaultGrid(800, 600), zones: [] }];
  state.music = { ...state.music, playing: true, position: 33, updatedAt: 1234, volume: 0.4 };
  return state;
}

test('history undo/redo restores grid but keeps players and live playback fields', () => {
  const history = new TableHistory();
  const before = tableState();
  history.record(before, 'Изменение сетки', 100, 'grid-change');
  const changed = {
    ...before,
    players: [{ id: 'player', name: 'Alice', connected: false }],
    maps: before.maps.map((map) => ({ ...map, grid: { ...map.grid, size: 120 } })),
    music: { ...before.music, playing: false, position: 44, updatedAt: 9999 },
  };

  const undone = history.undo(changed);
  assert.equal(undone.state.maps[0].grid.size, 80);
  assert.deepEqual(undone.state.players, changed.players);
  assert.equal(undone.state.music.playing, false);
  assert.equal(undone.state.music.position, 44);
  assert.equal(undone.state.music.updatedAt, 9999);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);

  const redone = history.redo(undone.state);
  assert.equal(redone.state.maps[0].grid.size, 120);
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);
  assert.deepEqual(history.items, [{ id: 'grid-change', label: 'Изменение сетки', createdAt: 100 }]);
});

test('history restores a deleted token and redo deletes it again', () => {
  const history = new TableHistory();
  const before = tableState();
  history.record(before, 'Удаление сущности');
  const after = removeEntity(before, 'token');
  assert.equal(after.entities.length, 0);

  const restored = history.undo(after).state;
  assert.equal(restored.entities[0].id, 'token');
  assert.equal(restored.entities[0].assetId, 'asset');
  const removedAgain = history.redo(restored).state;
  assert.equal(removedAgain.entities.length, 0);
});

test('a new recorded action clears redo and snapshots contain no session-only fields', () => {
  const history = new TableHistory();
  const initial = tableState();
  history.record(initial, 'Первое');
  const first = { ...initial, activeMapId: 'map' };
  const undone = history.undo(first).state;
  assert.equal(history.canRedo, true);

  history.record(undone, 'Новое действие');
  assert.equal(history.canRedo, false);
  assert.equal(history.redo(undone), null);
  const snapshot = createTableSnapshot(initial);
  assert.equal('players' in snapshot, false);
  assert.deepEqual(Object.keys(snapshot.music).sort(), ['currentId', 'repeat', 'tracks', 'volume']);
  assert.equal('playing' in snapshot.music, false);
  assert.equal('position' in snapshot.music, false);
  assert.equal('updatedAt' in snapshot.music, false);
});

test('history keeps at most 50 chronological entries', () => {
  const history = new TableHistory();
  const state = createDefaultState();
  for (let index = 0; index < 55; index += 1) history.record(state, `Action ${index}`, index, String(index));
  assert.equal(history.items.length, 50);
  assert.equal(history.items[0].label, 'Action 5');
  assert.equal(history.items.at(-1).label, 'Action 54');
});

test('zone autoSize defaults to true for new hex zones and survives sanitization', () => {
  const map = { id: 'map', grid: createDefaultGrid(), zones: [] };
  const updated = applyMapPatch(map, {
    zones: [
      { id: 'hex', name: 'Hex', type: 'hex', points: [] },
      { id: 'square', name: 'Square', type: 'square', autoSize: true, points: [] },
    ],
  });
  assert.equal(updated.zones[0].autoSize, true);
  assert.equal(updated.zones[1].autoSize, true);
  assert.throws(() => applyMapPatch(map, { zones: [{ type: 'hex', autoSize: 'yes', points: [] }] }));

  const normalized = sanitizeState({
    maps: [{
      id: 'map', name: 'Map', url: '/map.png', width: 100, height: 100, grid: createDefaultGrid(100, 100),
      zones: [{ id: 'loaded', name: 'Loaded', type: 'hex', points: [] }],
    }],
  });
  assert.equal(normalized.maps[0].zones[0].autoSize, true);
});
