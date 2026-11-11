import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import MapContent from './MapContent.jsx';
import ContextMenu from './ContextMenu.jsx';
import { mapAtPoint, snapOnBoard, snapSizeOnBoard } from '../../shared/geometry.js';
import { computeVisibilityPolygons, pointVisibleInPolygons } from '../../shared/vision.js';

const EMPTY_WIDTH = 1600;
const EMPTY_HEIGHT = 1000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default function Board({ state, role, playerId, send, editorMode, setEditorMode, selectedEntityId, onSelectEntity, selectedZoneId, onSelectZone, onOpenSettings }) {
  const viewportRef = useRef(null);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(0.7);
  const gestureRef = useRef(null);
  const didFitRef = useRef(false);
  const suppressClickRef = useRef(false);
  const [viewportSize, setViewportSize] = useState({ width: 1000, height: 700 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.7);
  const [localPositions, setLocalPositions] = useState({});
  const [localSizes, setLocalSizes] = useState({});
  const [localPlacementPositions, setLocalPlacementPositions] = useState({});
  const [draftBounds, setDraftBounds] = useState(null);
  const [draftPoints, setDraftPoints] = useState([]);
  const [menu, setMenu] = useState(null);
  const [previewVision, setPreviewVision] = useState(false);
  const [brushColor, setBrushColor] = useState('#e66b50');
  const [brushWidth, setBrushWidth] = useState(5);
  const [currentStroke, setCurrentStroke] = useState(null);
  const isHost = role === 'host';
  const placements = (state.placements || []).filter((placement) => placement.tableId === state.activeTableId);
  const displayPlacements = placements.map((placement) => ({ ...placement, ...(localPlacementPositions[placement.id] || {}) }));
  const activePlacement = placements.find((placement) => placement.id === state.activePlacementId) || null;
  const activeMap = state.maps.find((map) => map.id === activePlacement?.mapId) || null;
  const width = Math.max(EMPTY_WIDTH, ...displayPlacements.map((placement) => {
    const map = state.maps.find((item) => item.id === placement.mapId);
    return placement.x + (map?.width || 0) * placement.scale + 400;
  }));
  const height = Math.max(EMPTY_HEIGHT, ...displayPlacements.map((placement) => {
    const map = state.maps.find((item) => item.id === placement.mapId);
    return placement.y + (map?.height || 0) * placement.scale + 400;
  }));
  const displayState = { ...state, placements: displayPlacements };
  const viewBounds = useMemo(() => ({ x: -pan.x / zoom, y: -pan.y / zoom, width: viewportSize.width / zoom, height: viewportSize.height / zoom }), [pan, zoom, viewportSize]);

  const updatePan = useCallback((next) => { panRef.current = next; setPan(next); }, []);
  const updateZoom = useCallback((next) => { zoomRef.current = next; setZoom(next); }, []);

  const fitMap = useCallback(() => {
    const content = activePlacement && activeMap ? {
      x: activePlacement.x,
      y: activePlacement.y,
      width: activeMap.width * activePlacement.scale,
      height: activeMap.height * activePlacement.scale,
    } : { x: 0, y: 0, width: EMPTY_WIDTH, height: EMPTY_HEIGHT };
    const nextZoom = clamp(Math.min((viewportSize.width - 70) / content.width, (viewportSize.height - 70) / content.height), 0.08, 1.5);
    updateZoom(nextZoom);
    updatePan({ x: (viewportSize.width - content.width * nextZoom) / 2 - content.x * nextZoom, y: (viewportSize.height - content.height * nextZoom) / 2 - content.y * nextZoom });
  }, [viewportSize, activePlacement, activeMap, updatePan, updateZoom]);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      setViewportSize({ width: box.width, height: box.height });
    });
    if (viewportRef.current) observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (gestureRef.current) return;
    if (!didFitRef.current || isHost) {
      fitMap();
      didFitRef.current = true;
    }
    setDraftPoints([]);
  }, [state.activePlacementId]);

  useEffect(() => {
    setLocalPositions((positions) => {
      let changed = false;
      const next = { ...positions };
      for (const [id, position] of Object.entries(next)) {
        const entity = state.entities.find((item) => item.id === id);
        if (!entity || (Math.abs(entity.x - position.x) < 0.001 && Math.abs(entity.y - position.y) < 0.001)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : positions;
    });
    setLocalSizes((sizes) => {
      let changed = false;
      const next = { ...sizes };
      for (const [id, size] of Object.entries(next)) {
        const entity = state.entities.find((item) => item.id === id);
        if (!entity || Math.abs(entity.size - size) < 0.001) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : sizes;
    });
  }, [state.entities]);

  useEffect(() => {
    if (!Object.keys(localPositions).length && !Object.keys(localSizes).length) return;
    const timeout = setTimeout(() => {
      setLocalPositions({});
      setLocalSizes({});
    }, 2000);
    return () => clearTimeout(timeout);
  }, [localPositions, localSizes]);

  const toBoard = useCallback((clientX, clientY) => {
    const rect = viewportRef.current.getBoundingClientRect();
    return { x: (clientX - rect.left - panRef.current.x) / zoomRef.current, y: (clientY - rect.top - panRef.current.y) / zoomRef.current };
  }, []);
  const toLocal = useCallback((clientX, clientY, placement = activePlacement) => {
    const point = toBoard(clientX, clientY);
    return placement ? { x: (point.x - placement.x) / placement.scale, y: (point.y - placement.y) / placement.scale } : point;
  }, [toBoard, activePlacement]);

  const positionedEntities = state.entities.filter((entity) => entity.tableId === state.activeTableId).map((entity) => ({ ...entity, ...(localPositions[entity.id] || {}) }));
  const visionKey = JSON.stringify({
    placements: displayPlacements,
    maps: state.maps.map((map) => ({ id: map.id, width: map.width, height: map.height, vision: map.vision, walls: map.walls })),
    entities: positionedEntities,
  });
  const visionByPlacement = useMemo(() => {
    const result = {};
    for (const placement of displayPlacements) {
      const map = state.maps.find((item) => item.id === placement.mapId);
      if (!map?.vision?.enabled) continue;
      const sources = positionedEntities.filter((entity) => entity.kind === 'token' && (isHost || entity.ownerId === playerId) && mapAtPoint(entity.x, entity.y, displayState)?.placement.id === placement.id).map((entity) => ({
        ...entity,
        x: (entity.x - placement.x) / placement.scale,
        y: (entity.y - placement.y) / placement.scale,
      }));
      result[placement.id] = computeVisibilityPolygons(map, sources);
    }
    return result;
  }, [visionKey]);

  const entityHidden = (entity) => {
    if (isHost && !previewVision) return false;
    const context = mapAtPoint(entity.x, entity.y, displayState);
    if (!context?.map.vision?.enabled) return false;
    return !pointVisibleInPolygons({ x: context.x, y: context.y }, visionByPlacement[context.placement.id] || []);
  };

  const finishShape = useCallback((inputPoints) => {
    const source = inputPoints || draftPoints;
    if (!activeMap || source.length < 3) return;
    const points = source.filter((point, index) => index === 0 || Math.hypot(point.x - source[index - 1].x, point.y - source[index - 1].y) > 2);
    if (points.length < 3) return;
    if (editorMode === 'zone') {
      const zone = {
        id: crypto.randomUUID(),
        name: `Зона ${(activeMap.zones?.length || 0) + 1}`,
        type: 'hex',
        size: activeMap.grid.size,
        autoSize: true,
        color: activeMap.grid.color,
        opacity: Math.min(0.7, activeMap.grid.opacity + 0.15),
        offsetX: activeMap.grid.offsetX,
        offsetY: activeMap.grid.offsetY,
        points,
      };
      send('updateMap', { mapId: activeMap.id, patch: { zones: [...(activeMap.zones || []), zone] } });
      onSelectZone(zone.id);
    } else if (editorMode === 'vision') {
      const wall = { id: crypto.randomUUID(), name: `Преграда ${(activeMap.walls?.length || 0) + 1}`, points };
      send('updateMap', { mapId: activeMap.id, patch: { walls: [...(activeMap.walls || []), wall] } });
    }
    setDraftPoints([]);
    setDraftBounds(null);
    if (editorMode === 'zone') setEditorMode('select');
  }, [activeMap, draftPoints, editorMode, send, onSelectZone, setEditorMode]);

  useEffect(() => {
    const keyDown = (event) => {
      if (event.key === 'Escape') {
        setDraftPoints([]);
        setCurrentStroke(null);
        setDraftBounds(null);
        setMenu(null);
        if (editorMode !== 'select') setEditorMode('select');
      }
      if (event.key === 'Enter' && ['zone', 'vision'].includes(editorMode) && draftPoints.length >= 3) finishShape();
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [editorMode, draftPoints, finishShape, setEditorMode]);

  const zoomAt = (nextZoom, clientX, clientY) => {
    const rect = viewportRef.current.getBoundingClientRect();
    const x = clientX ?? rect.left + rect.width / 2;
    const y = clientY ?? rect.top + rect.height / 2;
    const clamped = clamp(nextZoom, 0.08, 3);
    const boardPoint = { x: (x - rect.left - panRef.current.x) / zoomRef.current, y: (y - rect.top - panRef.current.y) / zoomRef.current };
    updateZoom(clamped);
    updatePan({ x: x - rect.left - boardPoint.x * clamped, y: y - rect.top - boardPoint.y * clamped });
  };

  const pointerDown = (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    setMenu(null);
    if (['zone', 'vision', 'brush'].includes(editorMode)) event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (editorMode === 'brush') {
      const boardPoint = toBoard(event.clientX, event.clientY);
      const context = mapAtPoint(boardPoint.x, boardPoint.y, displayState);
      if (!context) return;
      const stroke = { placementId: context.placement.id, mapId: context.map.id, color: brushColor, width: brushWidth, opacity: isHost ? 1 : 0.85, points: [{ x: context.x, y: context.y }] };
      setCurrentStroke(stroke);
      gestureRef.current = { type: 'brush', stroke };
      return;
    }
    const point = toLocal(event.clientX, event.clientY);
    if (['zone', 'vision', 'bounds'].includes(editorMode) && activeMap) {
      gestureRef.current = { type: editorMode, start: point };
      if (editorMode === 'bounds') setDraftBounds({ x: point.x, y: point.y, width: 0, height: 0 });
    } else {
      gestureRef.current = { type: 'pan', x: event.clientX, y: event.clientY, pan: panRef.current };
      onSelectEntity(null);
      onSelectZone(null);
    }
  };

  const pointerMove = (event) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.type === 'pan') {
      updatePan({ x: gesture.pan.x + event.clientX - gesture.x, y: gesture.pan.y + event.clientY - gesture.y });
    } else if (gesture.type === 'map') {
      const point = toBoard(event.clientX, event.clientY);
      setLocalPlacementPositions((positions) => ({ ...positions, [gesture.id]: { x: gesture.origin.x + point.x - gesture.start.x, y: gesture.origin.y + point.y - gesture.start.y } }));
    } else if (gesture.type === 'brush') {
      const placement = displayPlacements.find((item) => item.id === gesture.stroke.placementId);
      if (!placement) return;
      const point = toLocal(event.clientX, event.clientY, placement);
      const previous = gesture.stroke.points.at(-1);
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5) return;
      gesture.stroke = { ...gesture.stroke, points: [...gesture.stroke.points, point] };
      setCurrentStroke(gesture.stroke);
    } else if (['bounds', 'zone', 'vision'].includes(gesture.type)) {
      const point = toLocal(event.clientX, event.clientY);
      const next = { x: Math.min(gesture.start.x, point.x), y: Math.min(gesture.start.y, point.y), width: Math.abs(point.x - gesture.start.x), height: Math.abs(point.y - gesture.start.y) };
      if (['zone', 'vision'].includes(gesture.type) && next.width > 5 && next.height > 5) setDraftPoints([]);
      setDraftBounds(next);
    }
  };

  const pointerUp = () => {
    const gesture = gestureRef.current;
    if (gesture?.type === 'brush') {
      const { mapId, placementId, ...stroke } = gesture.stroke;
      if (stroke.points.length >= 2) send('drawing:add', { mapId, stroke });
      setCurrentStroke(null);
      gestureRef.current = null;
      return;
    }
    if (gesture?.type === 'bounds' && draftBounds && draftBounds.width > 10 && draftBounds.height > 10) {
      const bounds = {
        x: clamp(draftBounds.x, 0, activeMap.width),
        y: clamp(draftBounds.y, 0, activeMap.height),
        width: clamp(draftBounds.width, 1, activeMap.width - Math.max(0, draftBounds.x)),
        height: clamp(draftBounds.height, 1, activeMap.height - Math.max(0, draftBounds.y)),
      };
      send('updateMap', { mapId: activeMap.id, patch: { grid: { ...activeMap.grid, bounds } } });
    } else if (['zone', 'vision'].includes(gesture?.type) && draftBounds && draftBounds.width > 10 && draftBounds.height > 10) {
      const { x, y, width: rectWidth, height: rectHeight } = draftBounds;
      suppressClickRef.current = true;
      finishShape([{ x, y }, { x: x + rectWidth, y }, { x: x + rectWidth, y: y + rectHeight }, { x, y: y + rectHeight }]);
    } else if (gesture?.type === 'map') {
      const position = localPlacementPositions[gesture.id];
      if (position) send('updatePlacement', { id: gesture.id, patch: position });
      setLocalPlacementPositions((positions) => {
        const copy = { ...positions };
        delete copy[gesture.id];
        return copy;
      });
    }
    gestureRef.current = null;
    setDraftBounds(null);
  };

  const boardClick = (event) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!['zone', 'vision'].includes(editorMode) || !activeMap) return;
    const point = toLocal(event.clientX, event.clientY);
    setDraftPoints((points) => [...points, point]);
  };

  const mapPointerDown = (event, placement) => {
    if (event.button !== 0) return;
    if (isHost) send('selectPlacement', { placementId: placement.id });
    if (isHost && editorMode === 'map') {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      gestureRef.current = { type: 'map', id: placement.id, start: toBoard(event.clientX, event.clientY), origin: { x: placement.x, y: placement.y } };
    }
  };

  const openMenu = (event, placementId = null, entityId = null) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isHost && entityId) return;
    setMenu({ x: event.clientX, y: event.clientY, point: toBoard(event.clientX, event.clientY), placementId, entityId });
  };

  const entityPointerDown = (event, entity) => {
    event.stopPropagation();
    setMenu(null);
    onSelectEntity(entity.id);
    onSelectZone(null);
    const canMove = isHost || (entity.kind === 'token' && entity.ownerId === playerId);
    if (!canMove || editorMode !== 'select') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toBoard(event.clientX, event.clientY);
    const position = localPositions[entity.id] || entity;
    gestureRef.current = { type: 'entity', id: entity.id, offsetX: point.x - position.x, offsetY: point.y - position.y };
  };

  const entityPointerMove = (event, entity) => {
    const gesture = gestureRef.current;
    if (gesture?.type !== 'entity' || gesture.id !== entity.id) return;
    const point = toBoard(event.clientX, event.clientY);
    const next = entity.kind === 'token' ? snapOnBoard(point.x - gesture.offsetX, point.y - gesture.offsetY, displayState, localSizes[entity.id] || entity.size) : { x: point.x - gesture.offsetX, y: point.y - gesture.offsetY };
    setLocalPositions((positions) => ({ ...positions, [entity.id]: next }));
  };

  const entityPointerUp = (event, entity) => {
    const gesture = gestureRef.current;
    if (gesture?.type !== 'entity' || gesture.id !== entity.id) return;
    const point = toBoard(event.clientX, event.clientY);
    const next = entity.kind === 'token' ? snapOnBoard(point.x - gesture.offsetX, point.y - gesture.offsetY, displayState, localSizes[entity.id] || entity.size) : { x: point.x - gesture.offsetX, y: point.y - gesture.offsetY };
    send('updateEntity', { id: entity.id, patch: { x: next.x, y: next.y } });
    gestureRef.current = null;
  };

  const resizePointerDown = (event, entity) => {
    event.stopPropagation();
    if (!isHost) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectEntity(entity.id);
    const position = localPositions[entity.id] || entity;
    gestureRef.current = { type: 'resize', id: entity.id, center: { x: position.x, y: position.y } };
  };

  const resizedSize = (event, entity) => {
    const gesture = gestureRef.current;
    const point = toBoard(event.clientX, event.clientY);
    const dx = point.x - gesture.center.x;
    const dy = point.y - gesture.center.y;
    const angle = -(entity.rotation || 0) * Math.PI / 180;
    const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
    const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
    const requested = Math.max(16, 2 * Math.max(Math.abs(localX), Math.abs(localY)));
    return entity.kind === 'token' ? snapSizeOnBoard(requested, gesture.center.x, gesture.center.y, displayState) : Math.min(2000, requested);
  };

  const resizePointerMove = (event, entity) => {
    if (gestureRef.current?.type !== 'resize' || gestureRef.current.id !== entity.id) return;
    setLocalSizes((sizes) => ({ ...sizes, [entity.id]: resizedSize(event, entity) }));
  };

  const resizePointerUp = (event, entity) => {
    if (gestureRef.current?.type !== 'resize' || gestureRef.current.id !== entity.id) return;
    const size = resizedSize(event, entity);
    const position = entity.kind === 'token' ? snapOnBoard(gestureRef.current.center.x, gestureRef.current.center.y, displayState, size) : gestureRef.current.center;
    send('updateEntity', { id: entity.id, patch: { size, x: position.x, y: position.y } });
    gestureRef.current = null;
  };

  const contextAction = (action, payload) => {
    setMenu(null);
    if (action === 'addEntity') {
      const asset = state.assets.find((item) => item.id === payload.id);
      if (!asset) return;
      const point = snapOnBoard(payload.point.x, payload.point.y, displayState);
      const context = mapAtPoint(point.x, point.y, displayState);
      const size = asset.kind === 'token' ? (context?.map.grid.size || 80) * (context?.scale || 1) : 120;
      send('addEntity', { assetId: asset.id, x: point.x, y: point.y, size, name: asset.name });
    } else if (action === 'placeMap') {
      const map = state.maps.find((item) => item.id === payload.id);
      if (map) send('placeMap', { mapId: map.id, x: payload.point.x - map.width / 2, y: payload.point.y - map.height / 2 });
    } else if (action === 'gridSettings') {
      onOpenSettings('grid', menu.placementId);
    } else if (action === 'visionSettings') {
      setEditorMode('vision');
      onOpenSettings('vision', menu.placementId);
    } else if (action === 'moveMap') {
      setEditorMode('map');
    } else if (action === 'removeMap') {
      send('removePlacement', { id: menu.placementId });
    } else if (action === 'entitySettings') {
      onSelectEntity(payload.id);
      onOpenSettings('entity', state.activePlacementId);
    } else if (action === 'addTurn') {
      send('turn:setOrder', { ids: [...state.turnOrder, payload.id] });
    } else if (action === 'deleteEntity') {
      send('deleteEntity', { id: payload.id });
    }
  };

  const denseGrid = activeMap?.grid.visible && activeMap.grid.type !== 'none' && activeMap.grid.size * (activePlacement?.scale || 1) * zoom < 4;
  const entities = [...positionedEntities].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'object' ? -1 : 1));

  return (
    <main className="board-shell">
      <div className="board-toolbar">
        <div className="tool-group">
          <button className={`tool-button ${editorMode === 'select' ? 'active' : ''}`} onClick={() => { setEditorMode('select'); setDraftPoints([]); }} title="Перемещение и масштаб"><Icon name="move" /><span>Стол</span></button>
          {isHost && activeMap && <><button className={`tool-button ${editorMode === 'bounds' ? 'active' : ''}`} onClick={() => { setEditorMode('bounds'); setDraftPoints([]); }} title="Область сетки"><Icon name="grid" /><span>Область</span></button><button className={`tool-button ${editorMode === 'zone' ? 'active' : ''}`} onClick={() => { setEditorMode('zone'); setDraftPoints([]); }} title="Новая зона"><Icon name="edit" /><span>Зона</span></button><button className={`tool-button ${editorMode === 'vision' ? 'active' : ''}`} onClick={() => { setEditorMode('vision'); setDraftPoints([]); onOpenSettings('vision', activePlacement.id); }} title="Поле зрения"><Icon name="eye" /><span>Зрение</span></button><button className={`tool-button ${previewVision ? 'active' : ''}`} onClick={() => setPreviewVision((value) => !value)} title="Показать туман как игроку"><Icon name="eye" /><span>Туман</span></button></>}
          {activeMap && <button className={`tool-button ${editorMode === 'brush' ? 'active' : ''}`} onClick={() => setEditorMode('brush')} title="Кисть"><Icon name="edit" /><span>Кисть</span></button>}
        </div>
        {isHost ? <div className="table-switcher"><select value={state.activeTableId} onChange={(event) => send('table:select', { tableId: event.target.value })} title="Выбрать стол">{state.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select><button className="icon-button compact" onClick={() => send('table:create')} title="Новый стол"><Icon name="plus" size={14} /></button>{state.activeTableId !== 'default' && <button className="icon-button compact danger" onClick={() => send('table:remove', { tableId: state.activeTableId })} title="Удалить стол"><Icon name="trash" size={13} /></button>}</div> : <span className="table-name">{state.tables.find((table) => table.id === state.activeTableId)?.name || 'Стол'}</span>}
        <div className="board-status">
          {editorMode === 'brush' && activeMap ? <div className="brush-controls"><input type="color" value={brushColor} onChange={(event) => setBrushColor(event.target.value)} title="Цвет" /><input type="range" min="1" max="20" value={brushWidth} onChange={(event) => setBrushWidth(Number(event.target.value))} title="Толщина" /><button className="icon-button compact" onClick={() => send('drawing:undo', { mapId: activeMap.id })} title="Отменить линию"><Icon name="previous" size={13} /></button><button className="icon-button compact danger" onClick={() => send('drawing:clear', { mapId: activeMap.id })} title="Очистить линии"><Icon name="trash" size={13} /></button></div> : ['zone', 'vision'].includes(editorMode) ? <><span>Клики — точки · потянуть — прямоугольник</span>{draftPoints.length >= 3 && <button className="button tiny primary" onClick={() => finishShape()}>Готово</button>}</> : editorMode === 'bounds' ? <span>Выделите область</span> : editorMode === 'map' ? <span>Перетащите карту</span> : denseGrid ? <span>Увеличьте масштаб</span> : <span>{activeMap?.name || 'Стол'}</span>}
        </div>
        <div className="tool-group zoom-controls"><button className="icon-button" onClick={() => zoomAt(zoomRef.current - 0.1)} title="Уменьшить"><Icon name="minus" /></button><button className="zoom-value" onClick={fitMap} title="Вписать карту">{Math.round(zoom * 100)}%</button><button className="icon-button" onClick={() => zoomAt(zoomRef.current + 0.1)} title="Увеличить"><Icon name="plus" /></button></div>
      </div>
      <div
        ref={viewportRef}
        className={`board-viewport mode-${editorMode}`}
        onWheel={(event) => { event.preventDefault(); zoomAt(zoomRef.current * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY); }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onClick={boardClick}
        onDoubleClick={(event) => { if (['zone', 'vision'].includes(editorMode)) { event.preventDefault(); finishShape(); } }}
        onContextMenu={(event) => openMenu(event)}
      >
        <div className="board-stage" style={{ width, height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          {displayPlacements.map((placement) => {
            const map = state.maps.find((item) => item.id === placement.mapId);
            if (!map) return null;
            return (
              <div
                key={placement.id}
                className={`map-placement ${state.activePlacementId === placement.id ? 'active' : ''} ${editorMode === 'map' ? 'editable' : ''}`}
                style={{ left: placement.x, top: placement.y, width: map.width, height: map.height, transform: `scale(${placement.scale})` }}
                onPointerDown={(event) => mapPointerDown(event, placement)}
                onContextMenu={(event) => openMenu(event, placement.id)}
              >
                <MapContent
                  map={map}
                  polygons={visionByPlacement[placement.id] || []}
                  isHost={isHost}
                  previewVision={previewVision}
                  editorMode={editorMode}
                  selectedZoneId={selectedZoneId}
                  viewBounds={{ x: (viewBounds.x - placement.x) / placement.scale, y: (viewBounds.y - placement.y) / placement.scale, width: viewBounds.width / placement.scale, height: viewBounds.height / placement.scale }}
                  draftBounds={state.activePlacementId === placement.id ? draftBounds : null}
                  draftPoints={state.activePlacementId === placement.id ? draftPoints : []}
                  zoom={zoom * placement.scale}
                  currentStroke={currentStroke?.placementId === placement.id ? currentStroke : null}
                />
              </div>
            );
          })}
          {entities.map((entity) => {
            if (entityHidden(entity)) return null;
            const asset = state.assets.find((item) => item.id === entity.assetId);
            const position = localPositions[entity.id] || entity;
            const size = localSizes[entity.id] || entity.size;
            const handleSize = clamp(size * zoom * 0.2, 3, 12) / zoom;
            const canMove = isHost || (entity.kind === 'token' && entity.ownerId === playerId);
            return (
              <div
                key={entity.id}
                className={`entity entity-${entity.kind} ${selectedEntityId === entity.id ? 'selected' : ''} ${state.currentTurn === entity.id ? 'current-turn' : ''} ${canMove ? 'movable' : ''}`}
                style={{ left: position.x, top: position.y, width: size, height: size, transform: `translate(-50%, -50%) rotate(${entity.rotation || 0}deg)` }}
                onPointerDown={(event) => entityPointerDown(event, entity)}
                onPointerMove={(event) => entityPointerMove(event, entity)}
                onPointerUp={(event) => entityPointerUp(event, entity)}
                onPointerCancel={(event) => entityPointerUp(event, entity)}
                onContextMenu={(event) => openMenu(event, null, entity.id)}
                title={`${entity.name}${canMove ? ' — можно перемещать' : ''}`}
              >
                {asset && <img src={asset.url} alt={entity.name} draggable="false" />}
                {isHost && selectedEntityId === entity.id && editorMode === 'select' && size * zoom >= 12 && ['nw', 'ne', 'sw', 'se'].map((corner) => <span key={corner} className={`resize-handle ${corner}`} style={{ width: handleSize, height: handleSize, borderWidth: 1 / zoom }} onPointerDown={(event) => resizePointerDown(event, entity)} onPointerMove={(event) => resizePointerMove(event, entity)} onPointerUp={(event) => resizePointerUp(event, entity)} onPointerCancel={(event) => resizePointerUp(event, entity)} />)}
                <span className="entity-label" style={{ transform: `rotate(-${entity.rotation || 0}deg)` }}>{entity.name}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="board-hint"><span>Колесо — масштаб</span><span>Фон — движение стола</span><span>ПКМ — действия</span></div>
      {menu && <ContextMenu menu={menu} state={state} isHost={isHost} onAction={contextAction} onClose={() => setMenu(null)} />}
    </main>
  );
}
