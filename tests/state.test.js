import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEntityUpdate,
  applyMapPatch,
  createDefaultGrid,
  createDefaultState,
  createEntity,
  createYouTubeTrack,
  extractYouTubeId,
  getMusicPosition,
  reduceMusic,
  removeEntity,
  setCurrentTurn,
  setTurnOrder,
  stepTurn,
} from '../server/state.js';

function entityState() {
  const state = createDefaultState();
  state.assets = [{ id: 'asset', kind: 'token', name: 'Hero', url: '/hero.png', width: 100, height: 100, createdAt: 1 }];
  state.players = [{ id: 'player', name: 'Alice', connected: true }];
  state.entities = [
    { id: 'a', assetId: 'asset', kind: 'token', name: 'A', x: 0, y: 0, size: 80, rotation: 0, ownerId: 'player' },
    { id: 'b', assetId: 'asset', kind: 'token', name: 'B', x: 0, y: 0, size: 80, rotation: 0, ownerId: null },
    { id: 'c', assetId: 'asset', kind: 'object', name: 'C', x: 0, y: 0, size: 80, rotation: 0, ownerId: 'player' },
  ];
  return state;
}

function musicState(repeat = 'off') {
  return {
    tracks: [{ id: 'one' }, { id: 'two' }, { id: 'three' }],
    currentId: 'one',
    playing: true,
    position: 10,
    updatedAt: 1_000,
    repeat,
    volume: 0.8,
  };
}

test('default state and map grid have the required shape', () => {
  const state = createDefaultState();
  assert.equal(state.version, 1);
  assert.equal(state.activeMapId, null);
  assert.equal(state.music.repeat, 'off');
  assert.deepEqual(createDefaultGrid(640, 480), {
    visible: true,
    type: 'square',
    size: 80,
    color: '#ffffff',
    opacity: 0.25,
    offsetX: 0,
    offsetY: 0,
    bounds: { x: 0, y: 0, width: 640, height: 480 },
  });
});

test('turn order is deduplicated, steps cyclically and cleans deleted entities', () => {
  let state = entityState();
  state = setTurnOrder(state, ['a', 'b', 'a', 'c']);
  assert.deepEqual(state.turnOrder, ['a', 'b', 'c']);
  assert.equal(state.currentTurn, 'a');
  state = stepTurn(state, -1);
  assert.equal(state.currentTurn, 'c');
  state = stepTurn(state, 1);
  assert.equal(state.currentTurn, 'a');
  state = setCurrentTurn(state, 'b');
  state = removeEntity(state, 'b');
  assert.deepEqual(state.turnOrder, ['a', 'c']);
  assert.equal(state.currentTurn, 'a');
  state = removeEntity(state, 'c');
  assert.equal(state.currentTurn, 'a');
  assert.throws(() => setCurrentTurn(state, 'c'));
});

test('music play and pause store elapsed seconds without double counting', () => {
  const music = musicState();
  assert.equal(getMusicPosition(music, 3_500), 12.5);
  const paused = reduceMusic(music, { action: 'pause' }, 3_500);
  assert.equal(paused.position, 12.5);
  assert.equal(paused.playing, false);
  assert.equal(getMusicPosition(paused, 9_000), 12.5);
  const resumed = reduceMusic(paused, { action: 'play' }, 9_000);
  assert.equal(resumed.position, 12.5);
  assert.equal(getMusicPosition(resumed, 10_000), 13.5);
});

test('music next/previous honors repeat all, off and one', () => {
  let music = musicState('all');
  music = reduceMusic(music, { action: 'previous' }, 2_000);
  assert.equal(music.currentId, 'three');
  assert.equal(music.position, 0);
  music = reduceMusic(music, { action: 'next' }, 3_000);
  assert.equal(music.currentId, 'one');

  music = reduceMusic(musicState('off'), { action: 'previous' }, 2_000);
  assert.equal(music.currentId, 'one');
  assert.equal(music.playing, false);
  music = { ...musicState('off'), currentId: 'three' };
  music = reduceMusic(music, { action: 'next' }, 2_000);
  assert.equal(music.currentId, 'three');
  assert.equal(music.playing, false);

  music = reduceMusic(musicState('one'), { action: 'next' }, 2_000);
  assert.equal(music.currentId, 'one');
  assert.equal(music.position, 0);
  assert.equal(music.playing, true);
});

test('music select, seek, repeat and volume are deterministic', () => {
  let music = reduceMusic(musicState(), { action: 'select', trackId: 'two' }, 2_000);
  assert.equal(music.currentId, 'two');
  assert.equal(music.playing, false);
  assert.equal(music.position, 0);
  music = reduceMusic(music, { action: 'seek', value: 42.5 }, 3_000);
  assert.equal(music.position, 42.5);
  assert.equal(music.updatedAt, 3_000);
  music = reduceMusic(music, { action: 'repeat', value: 'all' }, 4_000);
  music = reduceMusic(music, { action: 'volume', value: 0.35 }, 5_000);
  assert.equal(music.repeat, 'all');
  assert.equal(music.volume, 0.35);
  assert.throws(() => reduceMusic(music, { action: 'volume', value: 2 }));
});

test('players can only move their own tokens with finite coordinates', () => {
  const state = entityState();
  const player = { role: 'player', playerId: 'player' };
  const moved = applyEntityUpdate(state, 'a', { x: 12.5, y: -20 }, player);
  assert.equal(moved.entities[0].x, 12.5);
  assert.equal(moved.entities[0].y, -20);
  assert.equal(state.entities[0].x, 0, 'reducer does not mutate input');
  assert.throws(() => applyEntityUpdate(state, 'a', { name: 'Stolen' }, player));
  assert.throws(() => applyEntityUpdate(state, 'b', { x: 1 }, player));
  assert.throws(() => applyEntityUpdate(state, 'c', { x: 1 }, player));
  assert.throws(() => applyEntityUpdate(state, 'a', { x: Number.NaN }, player));
});

test('host can edit allowed entity fields but unknown patch fields are ignored', () => {
  const state = entityState();
  const updated = applyEntityUpdate(state, 'b', {
    name: '  Renamed  ',
    size: 120,
    rotation: 90,
    ownerId: 'player',
    kind: 'object',
    id: 'replacement',
  }, { role: 'host' });
  assert.equal(updated.entities[1].name, 'Renamed');
  assert.equal(updated.entities[1].size, 120);
  assert.equal(updated.entities[1].rotation, 90);
  assert.equal(updated.entities[1].ownerId, 'player');
  assert.equal(updated.entities[1].kind, 'token');
  assert.equal(updated.entities[1].id, 'b');
});

test('entity creation validates assets and owners', () => {
  const state = entityState();
  const entity = createEntity(state, { assetId: 'asset', ownerId: 'player' });
  assert.equal(entity.kind, 'token');
  assert.equal(entity.size, 80);
  assert.equal(entity.ownerId, 'player');
  assert.throws(() => createEntity(state, { assetId: 'missing' }));
  assert.throws(() => createEntity(state, { assetId: 'asset', ownerId: 'missing' }));
});

test('map patches validate grid and zones instead of trusting arbitrary values', () => {
  const state = createDefaultState();
  const map = { id: 'map', grid: createDefaultGrid(), zones: [] };
  const updated = applyMapPatch(map, {
    grid: { type: 'hex', size: 60, opacity: 0.5, bounds: { width: 900 } },
    zones: [{ name: 'No grid', type: 'none', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] }],
  });
  assert.equal(updated.grid.type, 'hex');
  assert.equal(updated.grid.bounds.width, 900);
  assert.equal(updated.grid.bounds.height, 800);
  assert.equal(updated.zones[0].type, 'none');
  assert.throws(() => applyMapPatch(map, { grid: { opacity: 2 } }));
  assert.throws(() => applyMapPatch(map, { zones: [{}] }));
  assert.equal(state.maps.length, 0);
});

test('YouTube extraction accepts only real youtube.com/youtu.be IDs', () => {
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=10'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(extractYouTubeId('https://youtube.com/watch?v=too-short'), null);
  const track = createYouTubeTrack({ name: 'Theme', videoId: 'dQw4w9WgXcQ' }, 123, 'track');
  assert.equal(track.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(track.createdAt, 123);
});
