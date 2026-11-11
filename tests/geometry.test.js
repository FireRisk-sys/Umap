import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveGrid,
  getCellCenter,
  gridAtPoint,
  hexCorners,
  nearestHexCenter,
  nearestSquareCenter,
  pointInPolygon,
  snapSizeToGrid,
  snapToGrid,
  squareCorners,
} from '../shared/geometry.js';

function squareMap() {
  return {
    grid: {
      visible: true,
      type: 'square',
      size: 100,
      offsetX: 0,
      offsetY: 0,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    },
    zones: [],
  };
}

test('square grid snaps to cell centers, including negative coordinates', () => {
  assert.deepEqual(nearestSquareCenter(149, 151, { size: 100, offsetX: 0, offsetY: 0 }), { x: 150, y: 150 });
  assert.deepEqual(nearestSquareCenter(-1, -101, { size: 100, offsetX: 0, offsetY: 0 }), { x: -50, y: -150 });
  assert.deepEqual(snapToGrid(149, 151, squareMap()), { x: 150, y: 150, gridType: 'square' });
  assert.deepEqual(snapToGrid(900, 100, squareMap()), { x: 900, y: 100, gridType: null });
});

test('square offsets shift cells and getCellCenter uses the same origin', () => {
  const grid = { type: 'square', size: 80, offsetX: 10, offsetY: 20 };
  assert.deepEqual(nearestSquareCenter(95, 105, grid), { x: 130, y: 140 });
  assert.deepEqual(getCellCenter(1, 1, grid), { x: 130, y: 140 });
  assert.deepEqual(squareCorners(50, 60, 20), [
    { x: 40, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 70 },
    { x: 40, y: 70 },
  ]);
});

test('pointy-top hex centers, offsets and corners use size as radius', () => {
  const grid = { type: 'hex', size: 10, offsetX: 5, offsetY: 7 };
  assert.deepEqual(getCellCenter(0, 0, grid), { x: 5, y: 7 });
  const secondColumn = getCellCenter(1, 0, grid);
  assert.ok(Math.abs(secondColumn.x - (5 + Math.sqrt(3) * 10)) < 1e-9);
  assert.equal(secondColumn.y, 7);
  const oddRow = getCellCenter(0, 1, grid);
  assert.ok(Math.abs(oddRow.x - (5 + Math.sqrt(3) * 5)) < 1e-9);
  assert.equal(oddRow.y, 22);

  const target = getCellCenter(2, -3, grid);
  const nearest = nearestHexCenter(target.x + 0.2, target.y - 0.2, grid);
  assert.ok(Math.abs(nearest.x - target.x) < 1e-9);
  assert.ok(Math.abs(nearest.y - target.y) < 1e-9);

  const corners = hexCorners(0, 0, 10);
  assert.equal(corners.length, 6);
  assert.deepEqual(corners[0], { x: 0, y: -10 });
  assert.ok(Math.abs(corners[1].x - Math.sqrt(3) * 5) < 1e-9);
  assert.equal(corners[1].y, -5);
});

test('last containing zone wins: hex and none can cover square grid', () => {
  const map = squareMap();
  const polygon = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }];
  map.zones = [
    { type: 'hex', size: 20, offsetX: 0, offsetY: 0, points: polygon },
    { type: 'none', size: 80, offsetX: 0, offsetY: 0, points: polygon },
  ];
  assert.equal(gridAtPoint(50, 50, map), null);
  assert.deepEqual(snapToGrid(50, 50, map), { x: 50, y: 50, gridType: null });

  map.zones.reverse();
  assert.equal(gridAtPoint(50, 50, map).type, 'hex');
  const snapped = snapToGrid(50, 50, map);
  assert.equal(snapped.gridType, 'hex');
  assert.deepEqual(gridAtPoint(400, 400, map).type, 'square');
});

test('polygon test handles boundaries, concavity and invalid polygons', () => {
  const concave = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 50, y: 50 },
    { x: 0, y: 100 },
  ];
  assert.equal(pointInPolygon({ x: 20, y: 20 }, concave), true);
  assert.equal(pointInPolygon({ x: 50, y: 80 }, concave), false);
  assert.equal(pointInPolygon({ x: 0, y: 40 }, concave), true);
  assert.equal(pointInPolygon({ x: 120, y: 20 }, concave), false);
  assert.equal(pointInPolygon({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }]), false);
});

test('invisible and none base grids are inactive', () => {
  const map = squareMap();
  map.grid.visible = false;
  map.zones = [{ type: 'hex', size: 40, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }];
  assert.equal(gridAtPoint(20, 20, map), null);
  assert.equal(snapToGrid(20, 20, map).gridType, null);
  map.grid.visible = true;
  map.zones = [];
  map.grid.type = 'none';
  assert.equal(gridAtPoint(20, 20, map), null);
});

test('autoSize hex width follows the base square grid for snapping and sizing', () => {
  const map = squareMap();
  const zone = { type: 'hex', size: 10, autoSize: true, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }] };
  map.zones = [zone];
  const effective = effectiveGrid(zone, map.grid);
  assert.ok(Math.abs(Math.sqrt(3) * effective.size - 100) < 1e-9);
  assert.equal(gridAtPoint(50, 50, map).size, effective.size);
  assert.equal(snapSizeToGrid(210, 50, 50, map), 100 * Math.sqrt(3));
  assert.equal(snapSizeToGrid(249, 50, 50, map), 100 * Math.sqrt(7));
  map.grid.size = 120;
  assert.equal(gridAtPoint(50, 50, map).size, 120 / Math.sqrt(3));
  assert.equal(snapSizeToGrid(237, 800, 500, map), 240);
});

test('manual hex and free sizes remain independent', () => {
  const map = squareMap();
  map.zones = [{ type: 'hex', size: 40, autoSize: false, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }] }];
  assert.equal(gridAtPoint(50, 50, map).size, 40);
  assert.equal(snapSizeToGrid(77, 900, 700, map), 77);
});
