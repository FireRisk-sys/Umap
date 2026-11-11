import { randomUUID } from 'node:crypto';

const GRID_TYPES = new Set(['square', 'hex', 'none']);
const REPEAT_MODES = new Set(['off', 'one', 'all']);
const ENTITY_PATCH_FIELDS = new Set(['name', 'x', 'y', 'size', 'rotation', 'ownerId']);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DRAWING_TTL = 15_000;
const MAX_COORDINATE = 10_000_000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function strictFinite(value, label, min = -MAX_COORDINATE, max = MAX_COORDINATE) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function text(value, fallback = '', maxLength = 100) {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

export function sanitizePlayerName(value) {
  const name = text(value, '', 40);
  return name.length >= 1 && name.length <= 40 ? name : null;
}

export function createDefaultGrid(width = 1200, height = 800) {
  return {
    visible: true,
    type: 'square',
    size: 80,
    color: '#ffffff',
    opacity: 0.25,
    offsetX: 0,
    offsetY: 0,
    bounds: { x: 0, y: 0, width, height },
  };
}

export function createDefaultVision() {
  return { enabled: false, range: 800, rays: 120, opacity: 0.9 };
}

export function createBlankMap(input) {
  if (!isObject(input)) throw new Error('Invalid blank map');
  const name = text(input.name, '', 100);
  if (!name || name.length > 60) throw new Error('Blank map name must contain 1..60 characters');
  if (!Number.isInteger(input.width) || input.width < 200 || input.width > 10_000) throw new Error('Blank map width must be an integer between 200 and 10000');
  if (!Number.isInteger(input.height) || input.height < 200 || input.height > 10_000) throw new Error('Blank map height must be an integer between 200 and 10000');
  if (typeof input.color !== 'string' || !HEX_COLOR.test(input.color)) throw new Error('Blank map color must be #RRGGBB');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}"><rect width="100%" height="100%" fill="${input.color}"/></svg>`;
  return {
    id: randomUUID(),
    name,
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: input.width,
    height: input.height,
    createdAt: Date.now(),
    grid: createDefaultGrid(input.width, input.height),
    zones: [],
    vision: createDefaultVision(),
    walls: [],
    drawings: [],
  };
}

export function createDefaultState() {
  return {
    version: 1,
    activeMapId: null,
    tables: [{ id: 'default', name: 'Стол 1' }],
    activeTableId: 'default',
    placements: [],
    activePlacementId: null,
    maps: [],
    assets: [],
    entities: [],
    players: [],
    turnOrder: [],
    currentTurn: null,
    music: {
      tracks: [],
      currentId: null,
      playing: false,
      position: 0,
      updatedAt: Date.now(),
      repeat: 'off',
      volume: 1,
    },
    sounds: [],
  };
}

export function resetState(state) {
  return { ...createDefaultState(), players: state.players.map((player) => ({ ...player })) };
}

function normalizeGrid(value, width, height) {
  const fallback = createDefaultGrid(width, height);
  if (!isObject(value)) return fallback;
  const bounds = isObject(value.bounds) ? value.bounds : {};
  return {
    visible: typeof value.visible === 'boolean' ? value.visible : fallback.visible,
    type: GRID_TYPES.has(value.type) ? value.type : fallback.type,
    size: finite(value.size, fallback.size) > 0 ? value.size : fallback.size,
    color: text(value.color, fallback.color, 64) || fallback.color,
    opacity: Math.min(1, Math.max(0, finite(value.opacity, fallback.opacity))),
    offsetX: finite(value.offsetX),
    offsetY: finite(value.offsetY),
    bounds: {
      x: finite(bounds.x),
      y: finite(bounds.y),
      width: Math.max(0, finite(bounds.width, width)),
      height: Math.max(0, finite(bounds.height, height)),
    },
  };
}

function normalizeVision(value) {
  const fallback = createDefaultVision();
  if (!isObject(value)) return fallback;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    range: Math.min(100_000, Math.max(10, finite(value.range, fallback.range))),
    rays: Math.min(720, Math.max(24, Math.round(finite(value.rays, fallback.rays)))),
    opacity: Math.min(1, Math.max(0, finite(value.opacity, fallback.opacity))),
  };
}

function normalizeWall(wall) {
  if (!isObject(wall) || !Array.isArray(wall.points) || wall.points.length < 3 || wall.points.length > 200) return null;
  if (wall.points.some((point) => !isObject(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  return {
    id: text(wall.id, randomUUID(), 100) || randomUUID(),
    name: text(wall.name, 'Wall', 100) || 'Wall',
    points: wall.points.map((point) => ({ x: point.x, y: point.y })),
  };
}

function normalizeWalls(value) {
  return Array.isArray(value) ? value.slice(0, 500).map(normalizeWall).filter(Boolean) : [];
}

function normalizeDrawing(drawing) {
  if (!isObject(drawing) || typeof drawing.color !== 'string' || !HEX_COLOR.test(drawing.color)) return null;
  if (!Number.isFinite(drawing.width) || drawing.width < 1 || drawing.width > 50) return null;
  if (!Number.isFinite(drawing.opacity) || drawing.opacity < 0 || drawing.opacity > 1) return null;
  if (!Array.isArray(drawing.points) || drawing.points.length < 2 || drawing.points.length > 2000) return null;
  if (drawing.points.some((point) => !isObject(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  return {
    id: text(drawing.id, randomUUID(), 100) || randomUUID(),
    ownerId: text(drawing.ownerId, '', 100),
    ownerName: text(drawing.ownerName, 'Player', 60) || 'Player',
    color: drawing.color,
    width: drawing.width,
    opacity: drawing.opacity,
    points: drawing.points.map((point) => ({ x: point.x, y: point.y })),
    createdAt: finite(drawing.createdAt, Date.now()),
    persistent: drawing.persistent === true,
  };
}

function normalizeZone(zone) {
  if (!isObject(zone)) return null;
  return {
    id: text(zone.id, randomUUID(), 100) || randomUUID(),
    name: text(zone.name, 'Zone', 100) || 'Zone',
    type: GRID_TYPES.has(zone.type) ? zone.type : 'none',
    size: finite(zone.size, 80) > 0 ? zone.size : 80,
    autoSize: typeof zone.autoSize === 'boolean' ? zone.autoSize : zone.type === 'hex',
    ...(typeof zone.color === 'string' ? { color: text(zone.color, '#ffffff', 64) } : {}),
    ...(zone.opacity !== undefined ? { opacity: Math.min(1, Math.max(0, finite(zone.opacity, 0.25))) } : {}),
    offsetX: finite(zone.offsetX),
    offsetY: finite(zone.offsetY),
    points: Array.isArray(zone.points)
      ? zone.points.filter((point) => isObject(point) && Number.isFinite(point.x) && Number.isFinite(point.y))
        .map((point) => ({ x: point.x, y: point.y }))
      : [],
  };
}

export function sanitizeState(value) {
  const state = createDefaultState();
  if (!isObject(value)) return state;

  state.maps = Array.isArray(value.maps) ? value.maps.filter(isObject).map((map) => {
    const width = finite(map.width, 1200) > 0 ? map.width : 1200;
    const height = finite(map.height, 800) > 0 ? map.height : 800;
    return {
      id: text(map.id, randomUUID(), 100) || randomUUID(),
      name: text(map.name, 'Map', 100) || 'Map',
      url: text(map.url, '', 2000),
      width,
      height,
      createdAt: finite(map.createdAt, Date.now()),
      grid: normalizeGrid(map.grid, width, height),
      zones: Array.isArray(map.zones) ? map.zones.map(normalizeZone).filter(Boolean) : [],
      vision: normalizeVision(map.vision),
      walls: normalizeWalls(map.walls),
      drawings: Array.isArray(map.drawings) ? map.drawings.map(normalizeDrawing).filter(Boolean) : [],
    };
  }) : [];
  state.assets = Array.isArray(value.assets) ? value.assets.filter(isObject).map((asset) => ({
    id: text(asset.id, randomUUID(), 100) || randomUUID(),
    kind: asset.kind === 'object' ? 'object' : 'token',
    name: text(asset.name, 'Asset', 100) || 'Asset',
    url: text(asset.url, '', 2000),
    width: finite(asset.width, 1200) > 0 ? asset.width : 1200,
    height: finite(asset.height, 800) > 0 ? asset.height : 800,
    createdAt: finite(asset.createdAt, Date.now()),
  })) : [];
  state.players = Array.isArray(value.players) ? value.players.filter(isObject).map((player) => ({
    id: text(player.id, randomUUID(), 100) || randomUUID(),
    name: sanitizePlayerName(player.name) ?? 'Player',
    connected: false,
  })) : [];
  state.tables = Array.isArray(value.tables) ? value.tables.filter(isObject).map((table) => ({
    id: text(table.id, randomUUID(), 100) || randomUUID(),
    name: text(table.name, 'Стол', 60) || 'Стол',
  })) : [];
  if (!state.tables.length) state.tables = [{ id: 'default', name: 'Стол 1' }];
  if (!state.tables.some((table) => table.id === 'default')) state.tables.unshift({ id: 'default', name: 'Стол 1' });
  state.activeTableId = state.tables.some((table) => table.id === value.activeTableId) ? value.activeTableId : 'default';
  const tableIds = new Set(state.tables.map((table) => table.id));
  const playerIds = new Set(state.players.map((player) => player.id));
  const assetIds = new Set(state.assets.map((asset) => asset.id));
  state.entities = Array.isArray(value.entities) ? value.entities.filter(isObject).map((entity) => ({
    id: text(entity.id, randomUUID(), 100) || randomUUID(),
    assetId: text(entity.assetId, '', 100),
    tableId: tableIds.has(entity.tableId) ? entity.tableId : 'default',
    kind: entity.kind === 'object' ? 'object' : 'token',
    name: text(entity.name, 'Entity', 100) || 'Entity',
    x: finite(entity.x),
    y: finite(entity.y),
    size: finite(entity.size, 80) > 0 ? entity.size : 80,
    rotation: finite(entity.rotation),
    ownerId: playerIds.has(entity.ownerId) ? entity.ownerId : null,
  })).filter((entity) => assetIds.has(entity.assetId)) : [];
  const entityIds = new Set(state.entities.map((entity) => entity.id));
  state.turnOrder = Array.isArray(value.turnOrder)
    ? [...new Set(value.turnOrder.filter((id) => entityIds.has(id)))]
    : [];
  state.currentTurn = entityIds.has(value.currentTurn) && state.turnOrder.includes(value.currentTurn)
    ? value.currentTurn
    : null;
  const mapIds = new Set(state.maps.map((map) => map.id));
  state.activeMapId = mapIds.has(value.activeMapId) ? value.activeMapId : null;
  const migratePlacement = !Array.isArray(value.placements) || value.placements.length === 0;
  state.placements = Array.isArray(value.placements) ? value.placements.filter((placement) =>
    isObject(placement) &&
    mapIds.has(placement.mapId) &&
    Number.isFinite(placement.x) &&
    Number.isFinite(placement.y) &&
    Number.isFinite(placement.scale) &&
    placement.scale >= 0.05 &&
    placement.scale <= 20
  ).map((placement) => ({
    id: text(placement.id, randomUUID(), 100) || randomUUID(),
    mapId: placement.mapId,
    tableId: tableIds.has(placement.tableId) ? placement.tableId : 'default',
    x: placement.x,
    y: placement.y,
    scale: placement.scale,
  })) : [];
  if (migratePlacement && state.activeMapId) {
    state.placements = [{ id: randomUUID(), mapId: state.activeMapId, tableId: 'default', x: 0, y: 0, scale: 1 }];
  }
  state.activePlacementId = state.placements.some((placement) => placement.id === value.activePlacementId && placement.tableId === state.activeTableId)
    ? value.activePlacementId
    : (state.placements.find((placement) => placement.tableId === state.activeTableId)?.id ?? state.placements[0]?.id ?? null);

  const music = isObject(value.music) ? value.music : {};
  state.music.tracks = Array.isArray(music.tracks) ? music.tracks.filter(isObject).map((track) => ({
    id: text(track.id, randomUUID(), 100) || randomUUID(),
    type: track.type === 'youtube' ? 'youtube' : 'audio',
    name: text(track.name, 'Track', 100) || 'Track',
    url: text(track.url, '', 2000),
    ...(track.type === 'youtube' && typeof track.videoId === 'string' ? { videoId: track.videoId } : {}),
    createdAt: finite(track.createdAt, Date.now()),
  })) : [];
  const trackIds = new Set(state.music.tracks.map((track) => track.id));
  state.music.currentId = trackIds.has(music.currentId) ? music.currentId : null;
  state.music.playing = false;
  state.music.position = Math.max(0, finite(music.position));
  state.music.updatedAt = Date.now();
  state.music.repeat = REPEAT_MODES.has(music.repeat) ? music.repeat : 'off';
  state.music.volume = Math.min(1, Math.max(0, finite(music.volume, 1)));
  state.sounds = Array.isArray(value.sounds) ? value.sounds.filter(isObject).map((sound) => ({
    id: text(sound.id, randomUUID(), 100) || randomUUID(),
    name: text(sound.name, 'Sound', 100) || 'Sound',
    url: text(sound.url, '', 2000),
    createdAt: finite(sound.createdAt, Date.now()),
  })) : [];
  return state;
}

export function removeExpiredDrawings(state, now = Date.now()) {
  let changed = false;
  const maps = state.maps.map((map) => {
    const drawings = (map.drawings ?? []).filter((drawing) => drawing.persistent || now - drawing.createdAt <= DRAWING_TTL);
    if (drawings.length === (map.drawings ?? []).length) return map;
    changed = true;
    return { ...map, drawings };
  });
  return changed ? { ...state, maps } : state;
}

export function publicState(state, now = Date.now()) {
  return JSON.parse(JSON.stringify(removeExpiredDrawings(state, now)));
}

export function patchGrid(base, patch) {
  if (!isObject(patch)) throw new Error('grid must be an object');
  const grid = normalizeGrid(base, base.bounds.width, base.bounds.height);
  if (patch.visible !== undefined) {
    if (typeof patch.visible !== 'boolean') throw new Error('grid.visible must be boolean');
    grid.visible = patch.visible;
  }
  if (patch.type !== undefined) {
    if (!GRID_TYPES.has(patch.type)) throw new Error('Invalid grid type');
    grid.type = patch.type;
  }
  if (patch.size !== undefined) grid.size = strictFinite(patch.size, 'grid.size', 1, 2000);
  if (patch.color !== undefined) {
    const color = text(patch.color, '', 64);
    if (!color) throw new Error('grid.color must be a non-empty string');
    grid.color = color;
  }
  if (patch.opacity !== undefined) grid.opacity = strictFinite(patch.opacity, 'grid.opacity', 0, 1);
  if (patch.offsetX !== undefined) grid.offsetX = strictFinite(patch.offsetX, 'grid.offsetX');
  if (patch.offsetY !== undefined) grid.offsetY = strictFinite(patch.offsetY, 'grid.offsetY');
  if (patch.bounds !== undefined) {
    if (!isObject(patch.bounds)) throw new Error('grid.bounds must be an object');
    const bounds = { ...grid.bounds };
    for (const key of ['x', 'y', 'width', 'height']) {
      if (patch.bounds[key] !== undefined) {
        bounds[key] = strictFinite(patch.bounds[key], `grid.bounds.${key}`, key === 'width' || key === 'height' ? 0 : -MAX_COORDINATE, MAX_COORDINATE);
      }
    }
    grid.bounds = bounds;
  }
  return grid;
}

function patchVision(base, patch) {
  if (!isObject(patch)) throw new Error('vision must be an object');
  const vision = normalizeVision(base);
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new Error('vision.enabled must be boolean');
    vision.enabled = patch.enabled;
  }
  if (patch.range !== undefined) vision.range = strictFinite(patch.range, 'vision.range', 10, 100_000);
  if (patch.rays !== undefined) {
    if (!Number.isInteger(patch.rays) || patch.rays < 24 || patch.rays > 720) throw new Error('vision.rays must be an integer between 24 and 720');
    vision.rays = patch.rays;
  }
  if (patch.opacity !== undefined) vision.opacity = strictFinite(patch.opacity, 'vision.opacity', 0, 1);
  return vision;
}

function sanitizeWall(wall) {
  if (!isObject(wall)) throw new Error('Each wall must be an object');
  if (!Array.isArray(wall.points) || wall.points.length < 3 || wall.points.length > 200) throw new Error('Wall points must contain 3..200 points');
  return {
    id: text(wall.id, randomUUID(), 100) || randomUUID(),
    name: text(wall.name, 'Wall', 100) || 'Wall',
    points: wall.points.map((point) => {
      if (!isObject(point)) throw new Error('Invalid wall point');
      return { x: strictFinite(point.x, 'wall point.x'), y: strictFinite(point.y, 'wall point.y') };
    }),
  };
}

function sanitizeWalls(walls) {
  if (!Array.isArray(walls) || walls.length > 500) throw new Error('walls must be an array with at most 500 entries');
  return walls.map(sanitizeWall);
}

function sanitizeZone(zone) {
  if (!isObject(zone)) throw new Error('Each zone must be an object');
  if (!GRID_TYPES.has(zone.type)) throw new Error('Invalid zone type');
  if (!Array.isArray(zone.points) || zone.points.length > 2000) throw new Error('Zone points must be an array');
  if (zone.autoSize !== undefined && typeof zone.autoSize !== 'boolean') throw new Error('zone.autoSize must be boolean');
  return {
    id: text(zone.id, randomUUID(), 100) || randomUUID(),
    name: text(zone.name, 'Zone', 100) || 'Zone',
    type: zone.type,
    size: zone.size === undefined ? 80 : strictFinite(zone.size, 'zone.size', 1, 2000),
    autoSize: zone.autoSize ?? zone.type === 'hex',
    ...(zone.color !== undefined ? { color: text(zone.color, '#ffffff', 64) || '#ffffff' } : {}),
    ...(zone.opacity !== undefined ? { opacity: strictFinite(zone.opacity, 'zone.opacity', 0, 1) } : {}),
    offsetX: zone.offsetX === undefined ? 0 : strictFinite(zone.offsetX, 'zone.offsetX'),
    offsetY: zone.offsetY === undefined ? 0 : strictFinite(zone.offsetY, 'zone.offsetY'),
    points: zone.points.map((point) => {
      if (!isObject(point)) throw new Error('Invalid zone point');
      return { x: strictFinite(point.x, 'point.x'), y: strictFinite(point.y, 'point.y') };
    }),
  };
}

export function applyMapPatch(map, patch) {
  if (!isObject(patch)) throw new Error('patch must be an object');
  return {
    ...map,
    ...(patch.grid !== undefined ? { grid: patchGrid(map.grid, patch.grid) } : {}),
    ...(patch.zones !== undefined
      ? { zones: Array.isArray(patch.zones) ? patch.zones.map(sanitizeZone) : (() => { throw new Error('zones must be an array'); })() }
      : {}),
    ...(patch.vision !== undefined ? { vision: patchVision(map.vision, patch.vision) } : {}),
    ...(patch.walls !== undefined ? { walls: sanitizeWalls(patch.walls) } : {}),
  };
}

function drawingOwner(actor) {
  if (actor?.role === 'host') return { ownerId: 'host', ownerName: 'GM', persistent: true };
  if (actor?.role === 'player' && actor.playerId) {
    return { ownerId: actor.playerId, ownerName: text(actor.playerName, 'Player', 60) || 'Player', persistent: false };
  }
  throw new Error('Approved player or host role required');
}

export function createDrawing(stroke, actor, now = Date.now()) {
  if (!isObject(stroke) || typeof stroke.color !== 'string' || !HEX_COLOR.test(stroke.color)) throw new Error('Drawing color must be #RRGGBB');
  const width = strictFinite(stroke.width, 'drawing.width', 1, 50);
  const opacity = strictFinite(stroke.opacity, 'drawing.opacity', 0, 1);
  if (!Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > 2000) throw new Error('Drawing points must contain 2..2000 points');
  const owner = drawingOwner(actor);
  return {
    id: randomUUID(),
    ...owner,
    color: stroke.color,
    width,
    opacity,
    points: stroke.points.map((point) => {
      if (!isObject(point)) throw new Error('Invalid drawing point');
      return { x: strictFinite(point.x, 'drawing point.x'), y: strictFinite(point.y, 'drawing point.y') };
    }),
    createdAt: now,
  };
}

export function clearDrawings(state, mapId, actor, strokeId) {
  const map = state.maps.find((item) => item.id === mapId);
  if (!map) throw new Error('Map not found');
  const owner = drawingOwner(actor);
  const drawings = map.drawings ?? [];
  if (strokeId !== undefined) {
    const stroke = drawings.find((item) => item.id === strokeId);
    if (!stroke) throw new Error('Drawing not found');
    if (actor.role !== 'host' && stroke.ownerId !== owner.ownerId) throw new Error('You can only clear your own drawings');
  }
  return {
    ...state,
    maps: state.maps.map((item) => item.id === mapId ? {
      ...item,
      drawings: strokeId !== undefined
        ? drawings.filter((drawing) => drawing.id !== strokeId)
        : actor.role === 'host'
          ? []
          : drawings.filter((drawing) => drawing.ownerId !== owner.ownerId),
    } : item),
  };
}

export function undoDrawing(state, mapId, actor) {
  const map = state.maps.find((item) => item.id === mapId);
  if (!map) throw new Error('Map not found');
  const owner = drawingOwner(actor);
  const drawings = map.drawings ?? [];
  const index = drawings.findLastIndex((drawing) => drawing.ownerId === owner.ownerId);
  if (index === -1) throw new Error('Drawing not found');
  return {
    ...state,
    maps: state.maps.map((item) => item.id === mapId ? { ...item, drawings: drawings.filter((_drawing, drawingIndex) => drawingIndex !== index) } : item),
  };
}

export function createPlacement(state, input) {
  if (!isObject(input) || !state.maps.some((map) => map.id === input.mapId)) throw new Error('Map not found');
  return {
    id: randomUUID(),
    mapId: input.mapId,
    tableId: input.tableId || state.activeTableId,
    x: input.x === undefined ? 0 : strictFinite(input.x, 'placement.x'),
    y: input.y === undefined ? 0 : strictFinite(input.y, 'placement.y'),
    scale: input.scale === undefined ? 1 : strictFinite(input.scale, 'placement.scale', 0.05, 20),
  };
}

export function applyPlacementPatch(placement, patch) {
  if (!isObject(patch)) throw new Error('patch must be an object');
  const updated = { ...placement };
  if (patch.x !== undefined) updated.x = strictFinite(patch.x, 'placement.x');
  if (patch.y !== undefined) updated.y = strictFinite(patch.y, 'placement.y');
  if (patch.scale !== undefined) updated.scale = strictFinite(patch.scale, 'placement.scale', 0.05, 20);
  return updated;
}

export function createEntity(state, input) {
  if (!isObject(input)) throw new Error('Invalid entity');
  const asset = state.assets.find((item) => item.id === input.assetId);
  if (!asset) throw new Error('Asset not found');
  if (input.ownerId !== undefined && input.ownerId !== null && !state.players.some((player) => player.id === input.ownerId)) {
    throw new Error('Owner not found');
  }
  return {
    id: randomUUID(),
    assetId: asset.id,
    tableId: input.tableId || state.activeTableId,
    kind: asset.kind,
    name: text(input.name, asset.name, 100) || asset.name,
    x: input.x === undefined ? 0 : strictFinite(input.x, 'x'),
    y: input.y === undefined ? 0 : strictFinite(input.y, 'y'),
    size: input.size === undefined ? 80 : strictFinite(input.size, 'size', 1, 2000),
    rotation: 0,
    ownerId: input.ownerId ?? null,
  };
}

export function applyEntityUpdate(state, id, patch, actor) {
  if (!isObject(patch)) throw new Error('patch must be an object');
  const entity = state.entities.find((item) => item.id === id);
  if (!entity) throw new Error('Entity not found');
  const isHost = actor?.role === 'host';
  if (!isHost) {
    const allowed = actor?.role === 'player' && entity.kind === 'token' && entity.ownerId === actor.playerId;
    if (!allowed || Object.keys(patch).some((key) => key !== 'x' && key !== 'y')) {
      throw new Error('You can only move your own token');
    }
  }

  const updated = { ...entity };
  for (const key of Object.keys(patch)) {
    if (!isHost && (key === 'x' || key === 'y')) {
      updated[key] = strictFinite(patch[key], key);
    }
  }
  if (isHost) {
    for (const key of Object.keys(patch)) {
      if (!ENTITY_PATCH_FIELDS.has(key)) continue;
      if (key === 'x' || key === 'y' || key === 'rotation') updated[key] = strictFinite(patch[key], key);
      if (key === 'size') updated.size = strictFinite(patch.size, 'size', 1, 2000);
      if (key === 'name') {
        const name = text(patch.name, '', 100);
        if (!name) throw new Error('name must not be empty');
        updated.name = name;
      }
      if (key === 'ownerId') {
        if (patch.ownerId !== null && !state.players.some((player) => player.id === patch.ownerId)) {
          throw new Error('Owner not found');
        }
        updated.ownerId = patch.ownerId;
      }
    }
  }
  return { ...state, entities: state.entities.map((item) => item.id === id ? updated : item) };
}

export function removeEntity(state, id) {
  const turnOrder = state.turnOrder.filter((entityId) => entityId !== id);
  return {
    ...state,
    entities: state.entities.filter((entity) => entity.id !== id),
    turnOrder,
    currentTurn: state.currentTurn === id ? (turnOrder[0] ?? null) : state.currentTurn,
  };
}

export function removeAsset(state, id) {
  const removedEntities = new Set(state.entities.filter((entity) => entity.assetId === id).map((entity) => entity.id));
  const turnOrder = state.turnOrder.filter((entityId) => !removedEntities.has(entityId));
  return {
    ...state,
    assets: state.assets.filter((asset) => asset.id !== id),
    entities: state.entities.filter((entity) => entity.assetId !== id),
    turnOrder,
    currentTurn: removedEntities.has(state.currentTurn) ? (turnOrder[0] ?? null) : state.currentTurn,
  };
}

export function setTurnOrder(state, ids) {
  if (!Array.isArray(ids)) throw new Error('ids must be an array');
  const entityIds = new Set(state.entities.map((entity) => entity.id));
  if (ids.some((id) => typeof id !== 'string' || !entityIds.has(id))) throw new Error('Invalid turn order');
  const turnOrder = [...new Set(ids)];
  return {
    ...state,
    turnOrder,
    currentTurn: state.currentTurn && turnOrder.includes(state.currentTurn) ? state.currentTurn : (turnOrder[0] ?? null),
  };
}

export function setCurrentTurn(state, id) {
  if (id !== null && !state.turnOrder.includes(id)) throw new Error('Turn entity is not in turnOrder');
  return { ...state, currentTurn: id };
}

export function stepTurn(state, direction) {
  if (direction !== 1 && direction !== -1) throw new Error('direction must be 1 or -1');
  if (state.turnOrder.length === 0) return { ...state, currentTurn: null };
  const currentIndex = state.turnOrder.indexOf(state.currentTurn);
  const nextIndex = currentIndex === -1
    ? (direction === 1 ? 0 : state.turnOrder.length - 1)
    : (currentIndex + direction + state.turnOrder.length) % state.turnOrder.length;
  return { ...state, currentTurn: state.turnOrder[nextIndex] };
}

export function getMusicPosition(music, now = Date.now()) {
  const position = Math.max(0, finite(music.position));
  if (!music.playing || !music.currentId) return position;
  return position + Math.max(0, now - finite(music.updatedAt, now)) / 1000;
}

function musicBase(music, now) {
  return { ...music, tracks: [...music.tracks], position: getMusicPosition(music, now), updatedAt: now };
}

export function reduceMusic(music, command, now = Date.now()) {
  if (!isObject(command)) throw new Error('Invalid music command');
  const next = musicBase(music, now);
  const currentIndex = next.tracks.findIndex((track) => track.id === next.currentId);

  if (command.action === 'play') {
    if (next.currentId === null && next.tracks.length) {
      next.currentId = next.tracks[0].id;
      next.position = 0;
    }
    if (next.currentId === null) throw new Error('No music tracks');
    next.playing = true;
  } else if (command.action === 'pause') {
    next.playing = false;
  } else if (command.action === 'select') {
    if (!next.tracks.some((track) => track.id === command.trackId)) throw new Error('Track not found');
    next.currentId = command.trackId;
    next.position = 0;
    next.playing = false;
  } else if (command.action === 'next' || command.action === 'previous') {
    if (!next.tracks.length) {
      next.currentId = null;
      next.playing = false;
      next.position = 0;
    } else if (next.repeat === 'one' && currentIndex !== -1) {
      next.position = 0;
    } else {
      const direction = command.action === 'next' ? 1 : -1;
      const targetIndex = currentIndex === -1
        ? (direction === 1 ? 0 : next.tracks.length - 1)
        : currentIndex + direction;
      if (targetIndex >= 0 && targetIndex < next.tracks.length) {
        next.currentId = next.tracks[targetIndex].id;
      } else if (next.repeat === 'all') {
        next.currentId = next.tracks[direction === 1 ? 0 : next.tracks.length - 1].id;
      } else {
        next.playing = false;
      }
      next.position = 0;
    }
  } else if (command.action === 'repeat') {
    if (!REPEAT_MODES.has(command.value)) throw new Error('Invalid repeat mode');
    next.repeat = command.value;
  } else if (command.action === 'volume') {
    next.volume = strictFinite(command.value, 'volume', 0, 1);
  } else if (command.action === 'seek') {
    next.position = strictFinite(command.value, 'position', 0, Number.MAX_SAFE_INTEGER);
  } else {
    throw new Error('Unknown music action');
  }
  return next;
}

export function extractYouTubeId(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const hostname = url.hostname.toLowerCase();
  let id = null;
  if (hostname === 'youtu.be' || hostname === 'www.youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)$/);
      id = match?.[1] ?? null;
    }
  }
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export function createYouTubeTrack(input, now = Date.now(), id = randomUUID()) {
  const videoId = extractYouTubeId(input.videoId || input.url);
  if (!videoId) throw new Error('Invalid YouTube URL or video ID');
  return {
    id,
    type: 'youtube',
    name: text(input.name, 'YouTube track', 100) || 'YouTube track',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    videoId,
    createdAt: now,
  };
}

export function removeMusicTrack(music, trackId, now = Date.now()) {
  const tracks = music.tracks.filter((track) => track.id !== trackId);
  if (tracks.length === music.tracks.length) throw new Error('Track not found');
  return {
    ...music,
    tracks,
    ...(music.currentId === trackId ? { currentId: null, playing: false, position: 0, updatedAt: now } : {}),
  };
}
