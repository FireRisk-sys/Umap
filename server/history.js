import { randomUUID } from 'node:crypto';

const HISTORY_LIMIT = 50;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function publicEntry(entry) {
  return { id: entry.id, label: entry.label, createdAt: entry.createdAt };
}

export function createTableSnapshot(state) {
  return clone({
    activeMapId: state.activeMapId,
    tables: state.tables,
    activeTableId: state.activeTableId,
    placements: state.placements,
    activePlacementId: state.activePlacementId,
    maps: state.maps,
    assets: state.assets,
    entities: state.entities,
    turnOrder: state.turnOrder,
    currentTurn: state.currentTurn,
    sounds: state.sounds,
    music: {
      tracks: state.music.tracks,
      currentId: state.music.currentId,
      repeat: state.music.repeat,
      volume: state.music.volume,
    },
  });
}

export function restoreTableSnapshot(state, snapshot) {
  return {
    ...state,
    activeMapId: snapshot.activeMapId,
    tables: clone(snapshot.tables),
    activeTableId: snapshot.activeTableId,
    placements: clone(snapshot.placements),
    activePlacementId: snapshot.activePlacementId,
    maps: clone(snapshot.maps),
    assets: clone(snapshot.assets),
    entities: clone(snapshot.entities),
    turnOrder: clone(snapshot.turnOrder),
    currentTurn: snapshot.currentTurn,
    sounds: clone(snapshot.sounds),
    players: state.players,
    music: {
      tracks: clone(snapshot.music.tracks),
      currentId: snapshot.music.currentId,
      repeat: snapshot.music.repeat,
      volume: snapshot.music.volume,
      playing: state.music.playing,
      position: state.music.position,
      updatedAt: state.music.updatedAt,
    },
  };
}

export class TableHistory {
  #entries = [];
  #redo = [];

  get canUndo() {
    return this.#entries.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  get items() {
    return this.#entries.map(publicEntry);
  }

  info() {
    return { canUndo: this.canUndo, canRedo: this.canRedo, items: this.items };
  }

  record(state, label, createdAt = Date.now(), id = randomUUID()) {
    const entry = {
      id,
      label: String(label || 'Действие'),
      createdAt,
      snapshot: createTableSnapshot(state),
    };
    this.#entries.push(entry);
    if (this.#entries.length > HISTORY_LIMIT) this.#entries.splice(0, this.#entries.length - HISTORY_LIMIT);
    this.#redo = [];
    return publicEntry(entry);
  }

  undo(state) {
    if (!this.canUndo) return null;
    const entry = this.#entries.pop();
    this.#redo.push({ ...entry, snapshot: createTableSnapshot(state) });
    return { state: restoreTableSnapshot(state, entry.snapshot), item: publicEntry(entry) };
  }

  redo(state) {
    if (!this.canRedo) return null;
    const entry = this.#redo.pop();
    this.#entries.push({ ...entry, snapshot: createTableSnapshot(state) });
    return { state: restoreTableSnapshot(state, entry.snapshot), item: publicEntry(entry) };
  }

  clear() {
    this.#entries = [];
    this.#redo = [];
  }
}
