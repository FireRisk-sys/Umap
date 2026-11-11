import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';

class Client {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.waiters = new Set();
    this.closed = new Promise((resolve) => socket.once('close', (code) => resolve(code)));
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

  static async connect(port) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const client = new Client(socket);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return client;
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  wait(predicate, timeout = 4000) {
    const index = this.messages.findIndex(predicate);
    if (index !== -1) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error('Timed out waiting for WebSocket message'));
        }, timeout),
      };
      this.waiters.add(waiter);
    });
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return this.closed;
    this.socket.close();
    return this.closed;
  }
}

async function waitUntil(predicate, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for filesystem condition');
}

test('library, reconnect, reset and session close integration', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'umap-session-library-'));
  const dataDir = path.join(root, 'data');
  const libraryDir = path.join(root, 'library');
  const clients = [];
  let instance;

  const connect = async () => {
    const client = await Client.connect(instance.port);
    clients.push(client);
    return client;
  };
  const importLibrary = (clientId, body) => fetch(`http://127.0.0.1:${instance.port}/api/library/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-id': clientId },
    body: JSON.stringify(body),
  });

  try {
    instance = await startServer({ port: 0, dev: false, dataDir, libraryDir });
    await Promise.all([
      writeFile(path.join(libraryDir, 'maps', 'test map.png'), Buffer.from('map')),
      writeFile(path.join(libraryDir, 'maps', 'ignored.txt'), 'not an image'),
      writeFile(path.join(libraryDir, 'tokens', 'hero.png'), Buffer.from('token')),
      writeFile(path.join(libraryDir, 'music', 'theme.mp3'), Buffer.from('music')),
      writeFile(path.join(libraryDir, 'sounds', 'hit.wav'), Buffer.from('sound')),
      writeFile(path.join(root, 'outside.png'), Buffer.from('outside')),
    ]);

    const claimResponse = await fetch(`http://127.0.0.1:${instance.port}/api/host/claim`, { method: 'POST' });
    const { hostKey } = await claimResponse.json();
    const host = await connect();
    host.send({ type: 'hello', hostKey });
    const hostWelcome = await host.wait((message) => message.type === 'welcome');
    assert.deepEqual(hostWelcome.history, { canUndo: false, canRedo: false, items: [] });

    let player = await connect();
    player.send({ type: 'hello', name: 'Alice' });
    const pending = await player.wait((message) => message.type === 'pending');
    host.send({ type: 'approvePlayer', playerId: pending.playerId });
    const approved = await player.wait((message) => message.type === 'welcome');
    assert.equal(approved.role, 'player');
    assert.equal('history' in approved, false);

    await player.close();
    player = await connect();
    player.send({ type: 'hello', name: 'Alice', playerId: pending.playerId });
    const reconnected = await player.wait((message) => message.type === 'welcome');
    assert.equal(reconnected.playerId, pending.playerId);
    assert.equal(reconnected.state.players[0].connected, true);

    const unauthorized = await fetch(`http://127.0.0.1:${instance.port}/api/library`);
    assert.equal(unauthorized.status, 401);
    const listingResponse = await fetch(`http://127.0.0.1:${instance.port}/api/library`, { headers: { 'x-client-id': hostKey } });
    const listing = await listingResponse.json();
    assert.equal(listing.items.length, 4);
    assert.equal(listing.items.some((item) => item.fileName === 'ignored.txt'), false);
    const listedMap = listing.items.find((item) => item.kind === 'map');
    assert.equal(listedMap.url, '/library/maps/test%20map.png');
    assert.equal(listedMap.name, 'test map');
    assert.equal(typeof listedMap.size, 'number');
    assert.equal(typeof listedMap.modifiedAt, 'number');
    const staticFile = await fetch(`http://127.0.0.1:${instance.port}${listedMap.url}`);
    assert.equal(staticFile.status, 200);

    const traversal = await importLibrary(hostKey, { kind: 'map', fileName: '../outside.png' });
    assert.equal(traversal.status, 400);
    const backslashTraversal = await importLibrary(hostKey, { kind: 'map', fileName: '..\\outside.png' });
    assert.equal(backslashTraversal.status, 400);

    const mapImport = await importLibrary(hostKey, { kind: 'map', fileName: 'test map.png', width: 640, height: 480 });
    assert.equal(mapImport.status, 201);
    const importedMap = (await mapImport.json()).item;
    assert.equal(importedMap.url, listedMap.url);
    assert.equal(importedMap.grid.bounds.width, 640);
    const importedState = await host.wait((message) => message.type === 'state' && message.state.maps.some((map) => map.id === importedMap.id));
    assert.equal(importedState.history.canUndo, true);
    assert.equal(importedState.history.items.at(-1).label, 'Импорт библиотеки');

    const tokenImport = await importLibrary(hostKey, { kind: 'token', fileName: 'hero.png' });
    const importedToken = (await tokenImport.json()).item;
    const audioImport = await importLibrary(pending.playerId, { kind: 'audio', fileName: 'theme.mp3' });
    assert.equal(audioImport.status, 201);
    const forbiddenSound = await importLibrary(pending.playerId, { kind: 'sound', fileName: 'hit.wav' });
    assert.equal(forbiddenSound.status, 403);

    host.send({ type: 'addEntity', assetId: importedToken.id, ownerId: pending.playerId });
    await host.wait((message) => message.type === 'state' && message.state.entities.length === 1);
    const resetForPlayer = player.wait((message) => message.type === 'state' && message.state.maps.length === 0 && message.state.players.length === 1);
    host.send({ type: 'table:reset' });
    const reset = await host.wait((message) => message.type === 'state' && message.state.maps.length === 0 && message.history.items.at(-1)?.label === 'Очистка стола');
    assert.equal(reset.state.players[0].id, pending.playerId);
    assert.equal(reset.state.players[0].connected, true);
    assert.equal(reset.state.entities.length, 0);
    assert.equal('history' in (await resetForPlayer), false);

    host.send({ type: 'history:undo' });
    const undone = await host.wait((message) => message.type === 'state' && message.state.maps.length === 1 && message.state.entities.length === 1);
    assert.equal(undone.state.players[0].id, pending.playerId);
    assert.equal(undone.history.canRedo, true);

    await writeFile(path.join(dataDir, 'uploads', 'disposable.png'), Buffer.from('delete me'));
    await waitUntil(async () => {
      try {
        await access(path.join(dataDir, 'session.json'));
        return true;
      } catch {
        return false;
      }
    });

    const pendingClient = await connect();
    pendingClient.send({ type: 'hello', name: 'Pending' });
    await pendingClient.wait((message) => message.type === 'pending');
    const closedMessages = [host, player, pendingClient].map((client) => client.wait((message) => message.type === 'session:closed'));
    host.send({ type: 'session:close' });
    for (const message of await Promise.all(closedMessages)) assert.deepEqual(message, { type: 'session:closed' });
    assert.equal(await host.closed, 4002);
    assert.equal(await player.closed, 4002);
    assert.equal(await pendingClient.closed, 4002);

    await waitUntil(async () => {
      try {
        await access(path.join(dataDir, 'session.json'));
        return false;
      } catch {
        return (await readdir(path.join(dataDir, 'uploads'))).length === 0;
      }
    });
    await access(path.join(dataDir, 'host.json'));
    assert.equal(await readFile(path.join(libraryDir, 'maps', 'test map.png'), 'utf8'), 'map');

    const newHost = await connect();
    newHost.send({ type: 'hello', hostKey });
    const cleanWelcome = await newHost.wait((message) => message.type === 'welcome');
    assert.equal(cleanWelcome.state.maps.length, 0);
    assert.equal(cleanWelcome.state.players.length, 0);
    assert.deepEqual(cleanWelcome.history, { canUndo: false, canRedo: false, items: [] });
    await newHost.close();
  } finally {
    for (const client of clients) await client.close();
    if (instance) await instance.close();
    await rm(root, { recursive: true, force: true });
  }
});
