import { pointInPolygon } from './geometry.js';

const EPSILON = 1e-7;

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function segmentEdges(points) {
  if (!Array.isArray(points) || points.length < 3) return [];
  return points.map((point, index) => [point, points[(index + 1) % points.length]]);
}

function boundaryEdges(width, height) {
  return segmentEdges([{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]);
}

export function raySegmentDistance(origin, direction, start, end, maximum = Infinity) {
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const denominator = cross(direction.x, direction.y, vx, vy);
  if (Math.abs(denominator) < EPSILON) return Infinity;
  const ox = start.x - origin.x;
  const oy = start.y - origin.y;
  const distance = cross(ox, oy, vx, vy) / denominator;
  const segmentPosition = cross(ox, oy, direction.x, direction.y) / denominator;
  return distance >= 0 && distance <= maximum && segmentPosition >= 0 && segmentPosition <= 1 ? distance : Infinity;
}

export function castVisibilityPolygon(origin, map, vision = map.vision) {
  const range = Math.max(1, Number(vision?.range) || 800);
  const rayCount = Math.max(24, Math.min(720, Math.round(Number(vision?.rays) || 120)));
  const edges = [
    ...boundaryEdges(map.width, map.height),
    ...(map.walls || []).flatMap((wall) => segmentEdges(wall.points)),
  ];
  const points = [];
  for (let index = 0; index < rayCount; index += 1) {
    const angle = index / rayCount * Math.PI * 2;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    let distance = range;
    for (const [start, end] of edges) {
      distance = Math.min(distance, raySegmentDistance(origin, direction, start, end, range));
    }
    points.push({ x: origin.x + direction.x * distance, y: origin.y + direction.y * distance });
  }
  return points;
}

export function computeVisibilityPolygons(map, sources) {
  if (!map?.vision?.enabled) return [];
  return sources
    .filter((source) => source.kind === 'token' && Number.isFinite(source.x) && Number.isFinite(source.y) && source.x >= 0 && source.x <= map.width && source.y >= 0 && source.y <= map.height)
    .map((source) => ({ entityId: source.id, points: castVisibilityPolygon(source, map) }));
}

export function pointVisibleInPolygons(point, polygons) {
  return polygons.some((polygon) => pointInPolygon(point, polygon.points || polygon));
}
