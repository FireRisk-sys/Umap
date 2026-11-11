import express from 'express';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import {
  applyEntityUpdate,
  applyMapPatch,
  applyPlacementPatch,
  clearDrawings,
  createBlankMap,
  createDefaultGrid,
  createDefaultState,
  createDefaultVision,
  createDrawing,
  createEntity,
  createPlacement,
  createYouTubeTrack,
  publicState,
  reduceMusic,
  removeAsset,
  removeEntity,
  removeExpiredDrawings,
  removeMusicTrack,
  resetState,
  sanitizePlayerName,
  sanitizeState,
  setCurrentTurn,
  setTurnOrder,
  stepTurn,
  undoDrawing,
} from './state.js';
import { TableHistory } from './history.js';
import { createLibraryDirectories, listLibrary, resolveLibraryFile } from './library.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);
const AUDIO_TYPES = new Map([
  ['audio/mpeg', '.mp3'],
  ['audio/mp3', '.mp3'],
  ['audio/ogg', '.ogg'],
  ['audio/wav', '.wav'],
  ['audio/mp4', '.m4a'],
  ['audio/webm', '.webm'],
  ['audio/aac', '.aac'],
]);
const UPLOAD_KINDS = new Set(['map', 'token', 'object', 'audio', 'sound']);

async function atomicWrite(filePath, contents) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, filePath);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Could not read ${filePath}: ${error.message}`);
    return fallback;
  }
}

function isLoopback(request) {
  const address = request.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function displayName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) || fallback;
}

function dimension(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 100_000 ? Math.round(number) : fallback;
}

function approvedUploader(request, state, hostKey) {
  const clientId = request.get('x-client-id');
  if (clientId === hostKey) return { role: 'host' };
  const player = state.players.find((item) => item.id === clientId);
  return player ? { role: 'player', playerId: player.id } : null;
}

const CONTENT_LABELS = {
  map: 'Загрузка карты',
  token: 'Загрузка токена',
  object: 'Загрузка объекта',
  audio: 'Загрузка музыки',
  sound: 'Загрузка звука',
};

function addContentItem(state, kind, { url, name, width = 1200, height = 800 }) {
  let item;
  let nextState;
  if (kind === 'map') {
    item = {
      id: randomUUID(), name, url, width, height, createdAt: Date.now(),
      grid: createDefaultGrid(width, height), zones: [], vision: createDefaultVision(), walls: [], drawings: [],
    };
    nextState = { ...state, maps: [...state.maps, item] };
  } else if (kind === 'token' || kind === 'object') {
    item = { id: randomUUID(), kind, name, url, width, height, createdAt: Date.now() };
    nextState = { ...state, assets: [...state.assets, item] };
  } else if (kind === 'audio') {
    item = { id: randomUUID(), type: 'audio', name, url, createdAt: Date.now() };
    nextState = { ...state, music: { ...state.music, tracks: [...state.music.tracks, item] } };
  } else {
    item = { id: randomUUID(), name, url, createdAt: Date.now() };
    nextState = { ...state, sounds: [...state.sounds, item] };
  }
  return { item, nextState };
}

function networkUrls(port) {
  const urls = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) urls.push(`http://${address.address}:${port}/`);
    }
  }
  return [...new Set(urls)];
}

export async function startServer(options = {}) {
  const dev = options.dev ?? process.argv.includes('--dev');
  const port = Number(options.port ?? process.env.PORT ?? 8000);
  const dataDirectory = path.resolve(options.dataDir ?? process.env.DATA_DIR ?? path.join(ROOT, 'data'));
  const libraryDirectory = path.resolve(options.libraryDir ?? process.env.LIBRARY_DIR ?? path.join(ROOT, 'library'));
  const uploadsDirectory = path.join(dataDirectory, 'uploads');
  const sessionPath = path.join(dataDirectory, 'session.json');
  const hostPath = path.join(dataDirectory, 'host.json');
  await mkdir(uploadsDirectory, { recursive: true });
  await createLibraryDirectories(libraryDirectory);

  const history = new TableHistory();
  let state = sanitizeState(await readJson(sessionPath, createDefaultState()));
  let hostData = await readJson(hostPath, null);
  if (!hostData || typeof hostData.hostKey !== 'string' || !hostData.hostKey) {
    hostData = { hostKey: randomUUID() };
    await atomicWrite(hostPath, JSON.stringify(hostData, null, 2));
  }
  const hostKey = hostData.hostKey;
  let saveQueue = Promise.resolve();

  function persistState() {
    const snapshot = JSON.stringify(state, null, 2);
    saveQueue = saveQueue.catch(() => {}).then(() => atomicWrite(sessionPath, snapshot));
    saveQueue.catch((error) => console.error(`Could not save session: ${error.message}`));
    return saveQueue;
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/host/claim', (request, response) => {
    if (!isLoopback(request)) return response.status(403).json({ error: 'Host claim is loopback-only' });
    return response.json({ hostKey });
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => callback(null, uploadsDirectory),
      filename: (_request, file, callback) => {
        const extension = IMAGE_TYPES.get(file.mimetype) ?? AUDIO_TYPES.get(file.mimetype);
        callback(null, `${randomUUID()}${extension}`);
      },
    }),
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
      if (!IMAGE_TYPES.has(file.mimetype) && !AUDIO_TYPES.has(file.mimetype)) {
        return callback(new Error('Unsupported MIME type'));
      }
      return callback(null, true);
    },
  });

  app.post('/api/upload', upload.single('file'), async (request, response) => {
    const kind = request.query.kind;
    const actor = approvedUploader(request, state, hostKey);
    const removeUpload = async () => {
      if (!request.file) return;
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(request.file.path);
      } catch {}
    };

    if (!UPLOAD_KINDS.has(kind) || !request.file || !actor) {
      await removeUpload();
      return response.status(!actor ? 401 : 400).json({ error: !actor ? 'Unauthorized upload' : 'Invalid upload' });
    }
    if (!['audio', 'token'].includes(kind) && actor.role !== 'host') {
      await removeUpload();
      return response.status(403).json({ error: 'Host role required' });
    }
    const expectedTypes = kind === 'audio' || kind === 'sound' ? AUDIO_TYPES : IMAGE_TYPES;
    const maximumSize = expectedTypes === IMAGE_TYPES ? 25 * 1024 * 1024 : 100 * 1024 * 1024;
    if (!expectedTypes.has(request.file.mimetype) || request.file.size > maximumSize) {
      await removeUpload();
      return response.status(400).json({ error: 'Invalid file type or size' });
    }

    const url = `/uploads/${request.file.filename}`;
    const name = displayName(request.body.name ?? request.get('name') ?? request.get('x-name'), request.file.originalname);
    const width = dimension(request.body.width ?? request.get('width'), 1200);
    const height = dimension(request.body.height ?? request.get('height'), 800);
    const { item, nextState } = addContentItem(state, kind, { url, name, width, height });
    await commit(nextState, CONTENT_LABELS[kind]);
    return response.status(201).json({ item });
  });

  app.get('/api/library', async (request, response) => {
    const actor = approvedUploader(request, state, hostKey);
    if (!actor) return response.status(401).json({ error: 'Unauthorized library access' });
    return response.json({ items: await listLibrary(libraryDirectory) });
  });

  app.post('/api/library/import', async (request, response) => {
    const actor = approvedUploader(request, state, hostKey);
    if (!actor) return response.status(401).json({ error: 'Unauthorized library import' });
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return response.status(400).json({ error: 'Invalid JSON body' });
    const { kind, fileName } = body;
    if (!['audio', 'token'].includes(kind) && actor.role !== 'host') return response.status(403).json({ error: 'Host role required' });
    const file = await resolveLibraryFile(libraryDirectory, kind, fileName);
    const parseDimension = (value, fallback) => {
      if (value === undefined) return fallback;
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0 || number > 100_000) throw new Error('Invalid image dimensions');
      return Math.round(number);
    };
    const width = parseDimension(body.width, 1200);
    const height = parseDimension(body.height, 800);
    const name = displayName(body.name, file.fallbackName);
    const { item, nextState } = addContentItem(state, kind, { url: file.url, name, width, height });
    await commit(nextState, 'Импорт библиотеки');
    return response.status(201).json({ item });
  });

  app.use('/uploads', express.static(uploadsDirectory));
  app.use('/library', express.static(libraryDirectory));
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Not found' }));

  let vite;
  if (dev) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distDirectory = path.join(ROOT, 'dist');
    app.use(express.static(distDirectory));
    app.use((request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return next();
      return response.sendFile(path.join(distDirectory, 'index.html'), (error) => error && next());
    });
  }
  app.use((error, _request, response, _next) => {
    const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    response.status(status).json({ error: error.message || 'Request failed' });
  });

  const server = createServer(app);
  const sockets = new Set();
  const pendingPlayers = new Map();
  const playerSockets = new Map();
  const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 });

  function pendingList() {
    return [...pendingPlayers.values()].map(({ id, name }) => ({ id, name }));
  }

  function send(socket, message) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function sendError(socket, message) {
    send(socket, { type: 'error', message });
  }

  function sendWelcome(socket, role, playerId) {
    send(socket, {
      type: 'welcome',
      role,
      ...(playerId ? { playerId } : {}),
      state: publicState(state),
      ...(role === 'host' ? { pendingPlayers: pendingList(), history: history.info() } : {}),
    });
  }

  function broadcastState() {
    const sharedState = publicState(state);
    const pending = pendingList();
    const hostHistory = history.info();
    for (const socket of sockets) {
      if (socket.role === 'host') send(socket, { type: 'state', state: sharedState, pendingPlayers: pending, history: hostHistory });
      else if (socket.role === 'player') send(socket, { type: 'state', state: sharedState });
    }
  }

  function commit(nextState, label) {
    if (label) history.record(state, label);
    state = nextState;
    const saved = persistState();
    broadcastState();
    return saved;
  }

  function requireHost(socket) {
    if (socket.role !== 'host') {
      sendError(socket, 'Host role required');
      return false;
    }
    return true;
  }

  function requireApproved(socket) {
    if (socket.role !== 'host' && socket.role !== 'player') {
      sendError(socket, 'Approved player or host role required');
      return false;
    }
    return true;
  }

  function closePending(id, rejected = true) {
    const pending = pendingPlayers.get(id);
    if (!pending) return false;
    pendingPlayers.delete(id);
    if (rejected) send(pending.socket, { type: 'rejected' });
    pending.socket.close(4001, 'Rejected');
    return true;
  }

  function handleHello(socket, message) {
    if (socket.role || socket.pendingPlayerId) return sendError(socket, 'Already identified');
    if (message.hostKey !== undefined) {
      if (message.hostKey !== hostKey) return sendError(socket, 'Invalid host key');
      socket.role = 'host';
      return sendWelcome(socket, 'host');
    }

    const name = sanitizePlayerName(message.name);
    if (!name) return sendError(socket, 'Player name must contain 1..40 characters');
    if (message.playerId) {
      const player = state.players.find((item) => item.id === message.playerId);
      if (player) {
        const previous = playerSockets.get(player.id);
        if (previous && previous !== socket) previous.close(4000, 'Reconnected');
        socket.role = 'player';
        socket.playerId = player.id;
        playerSockets.set(player.id, socket);
        state = {
          ...state,
          players: state.players.map((item) => item.id === player.id ? { ...item, name, connected: true } : item),
        };
        persistState();
        sendWelcome(socket, 'player', player.id);
        broadcastState();
        return;
      }
      const pending = pendingPlayers.get(message.playerId);
      if (pending) {
        const previous = pending.socket;
        pending.socket = socket;
        pending.name = name;
        socket.pendingPlayerId = pending.id;
        if (previous !== socket) previous.close(4000, 'Reconnected');
        send(socket, { type: 'pending', playerId: pending.id });
        broadcastState();
        return;
      }
    }

    const id = randomUUID();
    pendingPlayers.set(id, { id, name, socket });
    socket.pendingPlayerId = id;
    send(socket, { type: 'pending', playerId: id });
    broadcastState();
  }

  async function closeSession() {
    const targets = [...sockets].filter((socket) => socket.role === 'host' || socket.role === 'player' || socket.pendingPlayerId);
    for (const socket of targets) send(socket, { type: 'session:closed' });
    pendingPlayers.clear();
    playerSockets.clear();
    state = createDefaultState();
    history.clear();
    for (const socket of targets) {
      socket.sessionClosed = true;
      socket.close(4002, 'Session closed');
    }
    await saveQueue.catch(() => {});
    await unlink(sessionPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const entries = await readdir(uploadsDirectory, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isFile() || entry.isSymbolicLink()).map((entry) => unlink(path.join(uploadsDirectory, entry.name))));
  }

  async function handleMessage(socket, message) {
    if (socket.sessionClosed) return;
    if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') {
      return sendError(socket, 'Invalid message');
    }
    if (message.type === 'hello') return handleHello(socket, message);

    if (message.type === 'approvePlayer') {
      if (!requireHost(socket)) return;
      const pending = pendingPlayers.get(message.playerId);
      if (!pending || pending.socket.readyState !== WebSocket.OPEN) return sendError(socket, 'Pending player not found');
      pendingPlayers.delete(pending.id);
      pending.socket.role = 'player';
      pending.socket.playerId = pending.id;
      delete pending.socket.pendingPlayerId;
      playerSockets.set(pending.id, pending.socket);
      state = { ...state, players: [...state.players, { id: pending.id, name: pending.name, connected: true }] };
      persistState();
      sendWelcome(pending.socket, 'player', pending.id);
      broadcastState();
      return;
    }
    if (message.type === 'rejectPlayer') {
      if (!requireHost(socket)) return;
      if (!closePending(message.playerId)) return sendError(socket, 'Pending player not found');
      broadcastState();
      return;
    }
    if (message.type === 'removePlayer') {
      if (!requireHost(socket)) return;
      if (closePending(message.playerId)) {
        broadcastState();
        return;
      }
      if (!state.players.some((player) => player.id === message.playerId)) return sendError(socket, 'Player not found');
      const playerSocket = playerSockets.get(message.playerId);
      playerSockets.delete(message.playerId);
      if (playerSocket) {
        playerSocket.role = undefined;
        send(playerSocket, { type: 'rejected' });
        playerSocket.close(4001, 'Removed');
      }
      commit({
        ...state,
        players: state.players.filter((player) => player.id !== message.playerId),
        entities: state.entities.map((entity) => entity.ownerId === message.playerId ? { ...entity, ownerId: null } : entity),
      });
      return;
    }

    if (message.type === 'history:undo' || message.type === 'history:redo') {
      if (!requireHost(socket)) return;
      const result = message.type === 'history:undo' ? history.undo(state) : history.redo(state);
      if (!result) return sendError(socket, message.type === 'history:undo' ? 'Nothing to undo' : 'Nothing to redo');
      commit(result.state);
      return;
    }
    if (message.type === 'table:reset') {
      if (!requireHost(socket)) return;
      commit(resetState(state), 'Очистка стола');
      return;
    }
    if (message.type === 'session:close') {
      if (!requireHost(socket)) return;
      await closeSession();
      return;
    }
    if (message.type === 'table:create') {
      if (!requireHost(socket)) return;
      if (state.tables.length >= 30) return sendError(socket, 'Too many tables');
      const table = { id: randomUUID(), name: displayName(message.name, `Стол ${state.tables.length + 1}`) };
      commit({ ...state, tables: [...state.tables, table], activeTableId: table.id, activePlacementId: null }, 'Создание стола');
      return;
    }
    if (message.type === 'table:select') {
      if (!requireHost(socket)) return;
      if (!state.tables.some((table) => table.id === message.tableId)) return sendError(socket, 'Table not found');
      commit({ ...state, activeTableId: message.tableId, activePlacementId: state.placements.find((placement) => placement.tableId === message.tableId)?.id ?? null });
      return;
    }
    if (message.type === 'table:remove') {
      if (!requireHost(socket)) return;
      if (message.tableId === 'default') return sendError(socket, 'Default table cannot be removed');
      if (!state.tables.some((table) => table.id === message.tableId)) return sendError(socket, 'Table not found');
      const entityIds = new Set(state.entities.filter((entity) => entity.tableId === message.tableId).map((entity) => entity.id));
      const activeTableId = state.activeTableId === message.tableId ? 'default' : state.activeTableId;
      commit({
        ...state,
        tables: state.tables.filter((table) => table.id !== message.tableId),
        activeTableId,
        placements: state.placements.filter((placement) => placement.tableId !== message.tableId),
        activePlacementId: state.placements.find((placement) => placement.tableId === activeTableId)?.id ?? null,
        entities: state.entities.filter((entity) => entity.tableId !== message.tableId),
        turnOrder: state.turnOrder.filter((id) => !entityIds.has(id)),
        currentTurn: entityIds.has(state.currentTurn) ? null : state.currentTurn,
      }, 'Удаление стола');
      return;
    }
    if (message.type === 'createBlankMap') {
      if (!requireHost(socket)) return;
      const map = createBlankMap(message);
      const withMap = { ...state, maps: [...state.maps, map] };
      const placement = createPlacement(withMap, { mapId: map.id, tableId: state.activeTableId });
      commit({ ...withMap, placements: [...state.placements, placement], activePlacementId: placement.id }, 'Создание пустой карты');
      return;
    }
    if (message.type === 'selectMap') {
      if (!requireHost(socket)) return;
      if (message.mapId !== null && !state.maps.some((map) => map.id === message.mapId)) return sendError(socket, 'Map not found');
      commit({ ...state, activeMapId: message.mapId }, 'Выбор карты');
      return;
    }
    if (message.type === 'placeMap') {
      if (!requireHost(socket)) return;
      const placement = createPlacement(state, message);
      commit({ ...state, placements: [...state.placements, placement], activePlacementId: placement.id }, 'Добавление карты на стол');
      return;
    }
    if (message.type === 'selectPlacement') {
      if (!requireHost(socket)) return;
      if (!state.placements.some((placement) => placement.id === message.placementId)) return sendError(socket, 'Placement not found');
      commit({ ...state, activePlacementId: message.placementId });
      return;
    }
    if (message.type === 'updatePlacement') {
      if (!requireHost(socket)) return;
      const placement = state.placements.find((item) => item.id === message.id);
      if (!placement) return sendError(socket, 'Placement not found');
      const updated = applyPlacementPatch(placement, message.patch);
      commit({
        ...state,
        placements: state.placements.map((item) => item.id === placement.id ? updated : item),
      }, 'Перемещение карты');
      return;
    }
    if (message.type === 'removePlacement') {
      if (!requireHost(socket)) return;
      if (!state.placements.some((placement) => placement.id === message.id)) return sendError(socket, 'Placement not found');
      const placements = state.placements.filter((placement) => placement.id !== message.id);
      commit({
        ...state,
        placements,
        activePlacementId: state.activePlacementId === message.id ? (placements[0]?.id ?? null) : state.activePlacementId,
      }, 'Удаление карты со стола');
      return;
    }
    if (message.type === 'drawing:add') {
      if (!requireApproved(socket)) return;
      const map = state.maps.find((item) => item.id === message.mapId);
      if (!map) return sendError(socket, 'Map not found');
      const actor = {
        role: socket.role,
        playerId: socket.playerId,
        playerName: state.players.find((player) => player.id === socket.playerId)?.name,
      };
      const drawing = createDrawing(message.stroke, actor);
      commit({
        ...state,
        maps: state.maps.map((item) => item.id === map.id ? { ...item, drawings: [...(item.drawings ?? []), drawing] } : item),
      }, 'Добавление рисунка');
      return;
    }
    if (message.type === 'drawing:clear') {
      if (!requireApproved(socket)) return;
      const actor = {
        role: socket.role,
        playerId: socket.playerId,
        playerName: state.players.find((player) => player.id === socket.playerId)?.name,
      };
      commit(clearDrawings(state, message.mapId, actor, message.strokeId), 'Очистка рисунков');
      return;
    }
    if (message.type === 'drawing:undo') {
      if (!requireApproved(socket)) return;
      const actor = {
        role: socket.role,
        playerId: socket.playerId,
        playerName: state.players.find((player) => player.id === socket.playerId)?.name,
      };
      commit(undoDrawing(state, message.mapId, actor), 'Отмена рисунка');
      return;
    }
    if (message.type === 'updateMap') {
      if (!requireHost(socket)) return;
      const map = state.maps.find((item) => item.id === message.mapId);
      if (!map) return sendError(socket, 'Map not found');
      const updated = applyMapPatch(map, message.patch);
      commit({ ...state, maps: state.maps.map((item) => item.id === map.id ? updated : item) }, 'Изменение карты');
      return;
    }
    if (message.type === 'deleteMap') {
      if (!requireHost(socket)) return;
      if (!state.maps.some((map) => map.id === message.mapId)) return sendError(socket, 'Map not found');
      const placements = state.placements.filter((placement) => placement.mapId !== message.mapId);
      commit({
        ...state,
        maps: state.maps.filter((map) => map.id !== message.mapId),
        activeMapId: state.activeMapId === message.mapId ? null : state.activeMapId,
        placements,
        activePlacementId: placements.some((placement) => placement.id === state.activePlacementId)
          ? state.activePlacementId
          : (placements[0]?.id ?? null),
      }, 'Удаление карты');
      return;
    }
    if (message.type === 'addEntity') {
      if (!requireApproved(socket)) return;
      const asset = state.assets.find((item) => item.id === message.assetId);
      if (!asset) return sendError(socket, 'Asset not found');
      if (socket.role === 'player' && asset.kind !== 'token') return sendError(socket, 'Players can only create tokens');
      const entity = createEntity(state, { ...message, ownerId: socket.role === 'player' ? socket.playerId : message.ownerId });
      commit({ ...state, entities: [...state.entities, entity] }, socket.role === 'player' ? 'Добавление токена игроком' : 'Добавление сущности');
      return;
    }
    if (message.type === 'updateEntity') {
      if (!requireApproved(socket)) return;
      const nextState = applyEntityUpdate(state, message.id, message.patch, { role: socket.role, playerId: socket.playerId });
      commit(nextState, socket.role === 'player' ? 'Перемещение токена' : 'Изменение сущности');
      return;
    }
    if (message.type === 'deleteEntity') {
      if (!requireHost(socket)) return;
      if (!state.entities.some((entity) => entity.id === message.id)) return sendError(socket, 'Entity not found');
      commit(removeEntity(state, message.id), 'Удаление сущности');
      return;
    }
    if (message.type === 'deleteAsset') {
      if (!requireHost(socket)) return;
      if (!state.assets.some((asset) => asset.id === message.assetId)) return sendError(socket, 'Asset not found');
      commit(removeAsset(state, message.assetId), 'Удаление ассета');
      return;
    }
    if (message.type === 'deleteSound') {
      if (!requireHost(socket)) return;
      if (!state.sounds.some((sound) => sound.id === message.soundId)) return sendError(socket, 'Sound not found');
      commit({ ...state, sounds: state.sounds.filter((sound) => sound.id !== message.soundId) }, 'Удаление звука');
      return;
    }
    if (message.type === 'turn:setOrder') {
      if (!requireHost(socket)) return;
      commit(setTurnOrder(state, message.ids), 'Изменение очереди ходов');
      return;
    }
    if (message.type === 'turn:set') {
      if (!requireHost(socket)) return;
      commit(setCurrentTurn(state, message.id ?? null), 'Выбор текущего хода');
      return;
    }
    if (message.type === 'turn:step') {
      if (!requireHost(socket)) return;
      commit(stepTurn(state, message.direction), 'Переход хода');
      return;
    }
    if (message.type === 'music:addYouTube') {
      if (!requireApproved(socket)) return;
      const track = createYouTubeTrack(message);
      commit({ ...state, music: { ...state.music, tracks: [...state.music.tracks, track] } }, 'Добавление YouTube');
      return;
    }
    if (message.type === 'music:control') {
      if (!requireApproved(socket)) return;
      const label = message.action === 'select' ? 'Выбор музыки' : message.action === 'repeat' ? 'Режим повтора' : undefined;
      commit({ ...state, music: reduceMusic(state.music, message) }, label);
      return;
    }
    if (message.type === 'music:remove') {
      if (!requireHost(socket)) return;
      commit({ ...state, music: removeMusicTrack(state.music, message.trackId) }, 'Удаление музыки');
      return;
    }
    if (message.type === 'sound:play') {
      if (!requireHost(socket)) return;
      if (!state.sounds.some((sound) => sound.id === message.soundId)) return sendError(socket, 'Sound not found');
      const volume = message.volume === undefined ? 1 : message.volume;
      if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) return sendError(socket, 'Invalid volume');
      for (const client of sockets) {
        if (client.role === 'host' || client.role === 'player') send(client, { type: 'sound', action: 'play', soundId: message.soundId, volume });
      }
      return;
    }
    if (message.type === 'sound:stop') {
      if (!requireHost(socket)) return;
      for (const client of sockets) {
        if (client.role === 'host' || client.role === 'player') send(client, { type: 'sound', action: 'stop' });
      }
      return;
    }
    sendError(socket, 'Unknown message type');
  }

  wss.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('message', async (data) => {
      try {
        await handleMessage(socket, JSON.parse(data.toString()));
      } catch (error) {
        sendError(socket, error instanceof SyntaxError ? 'Invalid JSON' : error.message);
      }
    });
    socket.on('close', () => {
      sockets.delete(socket);
      if (socket.sessionClosed) return;
      if (socket.pendingPlayerId && pendingPlayers.get(socket.pendingPlayerId)?.socket === socket) {
        pendingPlayers.delete(socket.pendingPlayerId);
        broadcastState();
      }
      if (socket.role === 'player' && playerSockets.get(socket.playerId) === socket) {
        playerSockets.delete(socket.playerId);
        state = {
          ...state,
          players: state.players.map((player) => player.id === socket.playerId ? { ...player, connected: false } : player),
        };
        persistState();
        broadcastState();
      }
    });
    socket.on('error', (error) => console.warn(`WebSocket error: ${error.message}`));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
  const drawingCleanupInterval = setInterval(() => {
    const nextState = removeExpiredDrawings(state);
    if (nextState !== state) commit(nextState);
  }, 2000);
  const actualPort = server.address().port;
  console.log(`Host: http://localhost:${actualPort}/?host=1`);
  for (const url of networkUrls(actualPort)) console.log(`LAN: ${url}`);

  async function close() {
    clearInterval(drawingCleanupInterval);
    for (const socket of sockets) socket.close(1001, 'Server shutting down');
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    await saveQueue;
  }

  return { app, server, wss, close, port: actualPort, hostKey };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().then(({ close }) => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      close().finally(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
