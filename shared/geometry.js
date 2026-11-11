const EPSILON = 1e-9;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validPoint(point) {
  return point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

export function pointInPolygon(point, points) {
  if (!validPoint(point) || !Array.isArray(points) || points.length < 3) {
    return false;
  }

  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[previous];
    const b = points[index];
    if (!validPoint(a) || !validPoint(b)) return false;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared > 0) {
      const projection = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
      const closestX = a.x + projection * dx;
      const closestY = a.y + projection * dy;
      if (Math.hypot(point.x - closestX, point.y - closestY) <= EPSILON) return true;
    }

    const crosses = (a.y > point.y) !== (b.y > point.y);
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function validGrid(grid) {
  return grid && ['square', 'hex', 'none'].includes(grid.type) && isFiniteNumber(grid.size) && grid.size > 0;
}

export function effectiveGrid(grid, baseGrid) {
  if (grid?.type === 'hex' && grid.autoSize && baseGrid?.size > 0) {
    return {
      ...grid,
      size: baseGrid.type === 'square' ? baseGrid.size / Math.sqrt(3) : baseGrid.size,
    };
  }
  return grid;
}

export function cellWidth(grid) {
  return grid?.type === 'hex' ? Math.sqrt(3) * grid.size : grid?.size || 0;
}

const HEX_AREAS = [0, 1, 3, 7, 12, 19];

export function hexAreaForLevel(level) {
  if (level < HEX_AREAS.length) return HEX_AREAS[level];
  return 1 + 3 * (level - 1) * level;
}

export function hexSizeForLevel(level, grid) {
  return cellWidth(grid) * Math.sqrt(hexAreaForLevel(level));
}

function hexLevelForSize(size, grid) {
  let nearest = 1;
  let difference = Infinity;
  for (let level = 1; level <= 100; level += 1) {
    const current = Math.abs(hexSizeForLevel(level, grid) - size);
    if (current < difference) {
      nearest = level;
      difference = current;
    }
  }
  return nearest;
}

export function snapSizeToGrid(size, x, y, map) {
  const grid = gridAtPoint(x, y, map);
  if (!grid) return Math.max(16, size);
  if (grid.type === 'hex') return hexSizeForLevel(hexLevelForSize(size, grid), grid);
  const width = cellWidth(grid);
  return Math.max(1, Math.round(size / width)) * width;
}

export function gridAtPoint(x, y, map) {
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !map || map.grid?.visible === false) return null;
  const point = { x, y };
  let containingZone = null;

  if (Array.isArray(map.zones)) {
    for (const zone of map.zones) {
      if (validGrid(zone) && pointInPolygon(point, zone.points)) containingZone = zone;
    }
  }

  if (containingZone) return containingZone.type === 'none' ? null : effectiveGrid(containingZone, map.grid);

  const grid = map.grid;
  const bounds = grid?.bounds;
  if (
    !validGrid(grid) ||
    grid.type === 'none' ||
    grid.visible === false ||
    !bounds ||
    !isFiniteNumber(bounds.x) ||
    !isFiniteNumber(bounds.y) ||
    !isFiniteNumber(bounds.width) ||
    !isFiniteNumber(bounds.height) ||
    bounds.width < 0 ||
    bounds.height < 0
  ) {
    return null;
  }

  return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
    ? grid
    : null;
}

export function nearestSquareCenter(x, y, grid) {
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !grid || !isFiniteNumber(grid.size) || grid.size <= 0) return { x, y };
  const offsetX = isFiniteNumber(grid.offsetX) ? grid.offsetX : 0;
  const offsetY = isFiniteNumber(grid.offsetY) ? grid.offsetY : 0;
  return {
    x: offsetX + (Math.floor((x - offsetX) / grid.size) + 0.5) * grid.size,
    y: offsetY + (Math.floor((y - offsetY) / grid.size) + 0.5) * grid.size,
  };
}

export function getCellCenter(column, row, grid) {
  if (!validGrid(grid) || grid.type === 'none' || !Number.isFinite(column) || !Number.isFinite(row)) return null;
  const offsetX = isFiniteNumber(grid.offsetX) ? grid.offsetX : 0;
  const offsetY = isFiniteNumber(grid.offsetY) ? grid.offsetY : 0;

  if (grid.type === 'hex') {
    return {
      x: offsetX + Math.sqrt(3) * grid.size * (column + 0.5 * (row & 1)),
      y: offsetY + 1.5 * grid.size * row,
    };
  }

  return {
    x: offsetX + (column + 0.5) * grid.size,
    y: offsetY + (row + 0.5) * grid.size,
  };
}

export function nearestHexCenter(x, y, grid) {
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !grid || !isFiniteNumber(grid.size) || grid.size <= 0) return { x, y };
  const offsetX = isFiniteNumber(grid.offsetX) ? grid.offsetX : 0;
  const offsetY = isFiniteNumber(grid.offsetY) ? grid.offsetY : 0;
  const approximateRow = Math.round((y - offsetY) / (1.5 * grid.size));
  const approximateColumn = Math.round((x - offsetX) / (Math.sqrt(3) * grid.size));
  let nearest = null;
  let nearestDistance = Infinity;

  for (let row = approximateRow - 2; row <= approximateRow + 2; row += 1) {
    const rowParity = ((row % 2) + 2) % 2;
    const columnOffset = 0.5 * rowParity;
    const rowColumn = Math.round((x - offsetX) / (Math.sqrt(3) * grid.size) - columnOffset);
    for (let column = rowColumn - 2; column <= rowColumn + 2; column += 1) {
      const center = getCellCenter(column, row, { ...grid, type: 'hex' });
      const distance = (center.x - x) ** 2 + (center.y - y) ** 2;
      if (distance < nearestDistance) {
        nearest = center;
        nearestDistance = distance;
      }
    }
  }

  return nearest ?? { x: offsetX + approximateColumn, y: offsetY + approximateRow };
}

export function snapToGrid(x, y, map, entitySize = null) {
  const grid = gridAtPoint(x, y, map);
  if (!grid) return { x, y, gridType: null };
  const center = grid.type === 'hex' ? nearestHexCenter(x, y, grid) : nearestSquareCenter(x, y, grid);
  if (entitySize === null) return { ...center, gridType: grid.type };
  const cells = grid.type === 'hex' ? hexLevelForSize(entitySize, grid) : Math.max(1, Math.round(entitySize / cellWidth(grid)));
  if (cells % 2 !== 0) return { ...center, gridType: grid.type };
  if (grid.type === 'square') {
    const offsetX = isFiniteNumber(grid.offsetX) ? grid.offsetX : 0;
    const offsetY = isFiniteNumber(grid.offsetY) ? grid.offsetY : 0;
    return {
      x: offsetX + Math.round((x - offsetX) / grid.size) * grid.size,
      y: offsetY + Math.round((y - offsetY) / grid.size) * grid.size,
      gridType: grid.type,
    };
  }
  const vertex = hexCorners(center.x, center.y, grid.size).reduce((nearest, point) => {
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
    return distance < nearest.distance ? { point, distance } : nearest;
  }, { point: center, distance: Infinity });
  return { ...vertex.point, gridType: grid.type };
}

export function hexCorners(cx, cy, size) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 3;
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    return { x: Math.abs(x) < EPSILON ? 0 : x, y: Math.abs(y) < EPSILON ? 0 : y };
  });
}

export function squareCorners(cx, cy, size) {
  const half = size / 2;
  return [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
}

export function mapAtPoint(x, y, state) {
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !state) return null;
  for (let index = (state.placements?.length || 0) - 1; index >= 0; index -= 1) {
    const placement = state.placements[index];
    const map = state.maps.find((item) => item.id === placement.mapId);
    if (!map || !(placement.scale > 0)) continue;
    const localX = (x - placement.x) / placement.scale;
    const localY = (y - placement.y) / placement.scale;
    if (localX >= 0 && localX <= map.width && localY >= 0 && localY <= map.height) {
      return { placement, map, x: localX, y: localY, scale: placement.scale };
    }
  }
  return null;
}

export function snapOnBoard(x, y, state, entitySize = null) {
  const context = mapAtPoint(x, y, state);
  if (!context) return { x, y, gridType: null, placementId: null };
  const snapped = snapToGrid(context.x, context.y, context.map, entitySize === null ? null : entitySize / context.scale);
  return {
    x: context.placement.x + snapped.x * context.scale,
    y: context.placement.y + snapped.y * context.scale,
    gridType: snapped.gridType,
    placementId: context.placement.id,
  };
}

export function snapSizeOnBoard(size, x, y, state) {
  const context = mapAtPoint(x, y, state);
  if (!context) return Math.min(2000, Math.max(16, size));
  return Math.min(2000, snapSizeToGrid(size / context.scale, context.x, context.y, context.map) * context.scale);
}
