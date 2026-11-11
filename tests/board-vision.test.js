import test from 'node:test';
import assert from 'node:assert/strict';
import { hexAreaForLevel, hexSizeForLevel, mapAtPoint, snapOnBoard, snapSizeOnBoard, snapToGrid } from '../shared/geometry.js';
import { castVisibilityPolygon, computeVisibilityPolygons, pointVisibleInPolygons, raySegmentDistance } from '../shared/vision.js';

function board() {
  return {
    maps: [{ id: 'map', width: 800, height: 600, grid: { visible: true, type: 'square', size: 100, offsetX: 0, offsetY: 0, bounds: { x: 0, y: 0, width: 800, height: 600 } }, zones: [] }],
    placements: [{ id: 'placement', mapId: 'map', x: 1000, y: 500, scale: 2 }],
  };
}

test('mapAtPoint converts board coordinates and returns the top placement', () => {
  const state = board();
  assert.deepEqual(mapAtPoint(1400, 800, state), { placement: state.placements[0], map: state.maps[0], x: 200, y: 150, scale: 2 });
  assert.equal(mapAtPoint(10, 10, state), null);
  state.placements.push({ id: 'top', mapId: 'map', x: 1000, y: 500, scale: 1 });
  assert.equal(mapAtPoint(1100, 600, state).placement.id, 'top');
});

test('snap and token size respect map scale', () => {
  const state = board();
  assert.deepEqual(snapOnBoard(1401, 801, state), { x: 1500, y: 800, gridType: 'square', placementId: 'placement' });
  assert.equal(snapSizeOnBoard(210, 1400, 800, state), 200);
  assert.equal(snapSizeOnBoard(77, 10, 10, state), 77);
});

test('raySegmentDistance finds the nearest crossing and rejects parallel segments', () => {
  const distance = raySegmentDistance({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 50, y: -10 }, { x: 50, y: 10 }, 100);
  assert.equal(distance, 50);
  assert.equal(raySegmentDistance({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 5 }, 100), Infinity);
});

function visionMap(walls = []) {
  return { width: 500, height: 500, vision: { enabled: true, range: 200, rays: 120, opacity: 0.9 }, walls };
}

test('raycasting respects range and map boundary', () => {
  const polygon = castVisibilityPolygon({ x: 100, y: 100 }, visionMap());
  assert.equal(polygon.length, 120);
  const east = polygon[0];
  assert.ok(Math.abs(east.x - 300) < 1e-7);
  assert.ok(Math.abs(east.y - 100) < 1e-7);
});

test('rectangular wall blocks rays and creates a shadow', () => {
  const wall = { id: 'wall', points: [{ x: 150, y: 50 }, { x: 160, y: 50 }, { x: 160, y: 150 }, { x: 150, y: 150 }] };
  const polygon = castVisibilityPolygon({ x: 100, y: 100 }, visionMap([wall]));
  assert.ok(Math.abs(polygon[0].x - 150) < 1e-7);
  const polygons = computeVisibilityPolygons(visionMap([wall]), [{ id: 'hero', kind: 'token', x: 100, y: 100 }]);
  assert.equal(pointVisibleInPolygons({ x: 120, y: 100 }, polygons), true);
  assert.equal(pointVisibleInPolygons({ x: 400, y: 400 }, polygons), false);
});

test('polygon wall also blocks visibility', () => {
  const wall = { id: 'triangle', points: [{ x: 150, y: 50 }, { x: 170, y: 100 }, { x: 150, y: 150 }] };
  const polygon = castVisibilityPolygon({ x: 100, y: 100 }, visionMap([wall]));
  assert.ok(Math.abs(polygon[0].x - 150) < 1e-7);
});

test('even square token size anchors to grid intersections', () => {
  const state = board();
  assert.deepEqual(snapOnBoard(1401, 801, state, 400), { x: 1400, y: 900, gridType: 'square', placementId: 'placement' });
  assert.deepEqual(snapOnBoard(1401, 801, state, 200), { x: 1500, y: 800, gridType: 'square', placementId: 'placement' });
});

test('even hex token size anchors to the nearest hex vertex', () => {
  const map = board().maps[0];
  map.grid.type = 'hex';
  const anchored = snapToGrid(149, 151, map, 300);
  assert.equal(anchored.gridType, 'hex');
  assert.ok(Math.abs(anchored.x - Math.sqrt(3) * 100) < 1e-7);
  assert.ok(Math.abs(anchored.y - 200) < 1e-7);
});

test('even snap works without offsets and size is capped', () => {
  const state = board();
  delete state.maps[0].grid.offsetX;
  delete state.maps[0].grid.offsetY;
  const anchored = snapToGrid(149, 151, state.maps[0], 200);
  assert.deepEqual(anchored, { x: 100, y: 200, gridType: 'square' });
  assert.equal(snapSizeOnBoard(10000, 10, 10, state), 2000);
});

test('hex token size follows occupied area from the reference image', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(hexAreaForLevel), [1, 3, 7, 12, 19]);
  const grid = { type: 'hex', size: 100 };
  assert.equal(hexSizeForLevel(1, grid), 100 * Math.sqrt(3));
  assert.ok(Math.abs(hexSizeForLevel(2, grid) - 300) < 1e-7);
  assert.ok(Math.abs(hexSizeForLevel(3, grid) - 100 * Math.sqrt(21)) < 1e-7);
});
