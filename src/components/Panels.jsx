import React, { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import TokenCropper from './TokenCropper.jsx';
import LibraryPicker from './LibraryPicker.jsx';
import VisionPanel from './VisionPanel.jsx';
import PlayerTokensPanel from './PlayerTokensPanel.jsx';

function FileButton({ accept, onFile, children, icon = 'upload', disabled = false, className = '' }) {
  const inputRef = useRef(null);
  return (
    <>
      <button className={`button secondary ${className}`} disabled={disabled} onClick={() => inputRef.current?.click()}><Icon name={icon} />{children}</button>
      <input ref={inputRef} hidden type="file" accept={accept} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = ''; }} />
    </>
  );
}

async function imageDimensions(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function GridSettings({ map, send, selectedZoneId, onSelectZone, onDrawZone }) {
  const updateGrid = (patch) => send('updateMap', { mapId: map.id, patch: { grid: { ...map.grid, ...patch } } });
  const zones = map.zones || [];
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId);
  const updateZone = (patch) => {
    if (!selectedZone) return;
    send('updateMap', { mapId: map.id, patch: { zones: zones.map((zone) => zone.id === selectedZone.id ? { ...zone, ...patch } : zone) } });
  };
  const moveZone = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= zones.length) return;
    const next = [...zones];
    [next[index], next[target]] = [next[target], next[index]];
    send('updateMap', { mapId: map.id, patch: { zones: next } });
  };

  return (
    <section className="panel-section">
      <div className="section-heading"><div><span className="eyebrow">Геометрия</span><h3>Сетка карты</h3></div><Icon name="grid" /></div>
      <label className="toggle-row"><input type="checkbox" checked={map.grid.visible} onChange={(event) => updateGrid({ visible: event.target.checked })} /><span>Показывать сетку</span></label>
      <div className="form-grid two-columns">
        <label className="field-label">Тип<select value={map.grid.type} onChange={(event) => updateGrid({ type: event.target.value, visible: true })}><option value="square">Квадратная</option><option value="hex">Шестиугольная</option><option value="none">Без сетки</option></select></label>
        <label className="field-label">Размер, px<input type="number" min="8" max="500" value={map.grid.size} onChange={(event) => updateGrid({ size: Number(event.target.value) })} /></label>
        <label className="field-label">Сдвиг X<input type="number" value={map.grid.offsetX} onChange={(event) => updateGrid({ offsetX: Number(event.target.value) })} /></label>
        <label className="field-label">Сдвиг Y<input type="number" value={map.grid.offsetY} onChange={(event) => updateGrid({ offsetY: Number(event.target.value) })} /></label>
      </div>
      <label className="field-label">Прозрачность <span className="field-value">{Math.round(map.grid.opacity * 100)}%</span><input type="range" min="0.05" max="1" step="0.05" value={map.grid.opacity} onChange={(event) => updateGrid({ opacity: Number(event.target.value) })} /></label>
      <label className="color-row"><span>Цвет линий</span><input type="color" value={map.grid.color} onChange={(event) => updateGrid({ color: event.target.value })} /></label>
      <p className="hint">Кнопка «Область» над картой задаёт прямоугольник, внутри которого действует базовая сетка.</p>
      <div className="button-grid"><button className="button secondary" onClick={() => updateGrid({ type: 'none', visible: true })}><Icon name="close" />Удалить сетку</button><button className="button secondary" disabled={!zones.length} onClick={() => { send('updateMap', { mapId: map.id, patch: { zones: [] } }); onSelectZone(null); }}><Icon name="trash" />Удалить зоны</button></div>
      <div className="subsection-heading"><h4>Особые зоны <span className="count-badge">{zones.length}</span></h4><button className="button tiny secondary" onClick={onDrawZone}><Icon name="plus" size={14} />Нарисовать</button></div>
      {zones.length === 0 && <p className="hint">Нарисуйте полигон, чтобы внутри квадратной карты сделать hex-участок или убрать сетку.</p>}
      <div className="zone-list">
        {zones.map((zone, index) => <div key={zone.id} className={`zone-row ${selectedZoneId === zone.id ? 'selected' : ''}`}><button className="zone-select" onClick={() => onSelectZone(zone.id)}><span className={`grid-swatch ${zone.type}`} />{zone.name}</button><button className="icon-button compact" disabled={index === zones.length - 1} onClick={() => moveZone(index, 1)} title="Поднять слой"><Icon name="chevronLeft" className="rotate-90" size={14} /></button><button className="icon-button compact" disabled={index === 0} onClick={() => moveZone(index, -1)} title="Опустить слой"><Icon name="chevronRight" className="rotate-90" size={14} /></button></div>)}
      </div>
      {selectedZone && <div className="selected-zone-settings">
        <div className="subsection-heading"><h4>Настройки зоны</h4><button className="icon-button danger" onClick={() => { send('updateMap', { mapId: map.id, patch: { zones: zones.filter((zone) => zone.id !== selectedZone.id) } }); onSelectZone(null); }} title="Удалить зону"><Icon name="trash" /></button></div>
        <label className="field-label">Название<input value={selectedZone.name} maxLength={60} onChange={(event) => updateZone({ name: event.target.value })} /></label>
        <div className="form-grid two-columns">
          <label className="field-label">Сетка<select value={selectedZone.type} onChange={(event) => updateZone({ type: event.target.value, autoSize: event.target.value === 'hex' })}><option value="square">Квадратная</option><option value="hex">Шестиугольная</option><option value="none">Без сетки</option></select></label>
          <label className="field-label">Размер<input type="number" min="8" max="500" disabled={selectedZone.type === 'hex' && selectedZone.autoSize} value={selectedZone.size} onChange={(event) => updateZone({ size: Number(event.target.value) })} /></label>
          <label className="field-label">Сдвиг X<input type="number" value={selectedZone.offsetX} onChange={(event) => updateZone({ offsetX: Number(event.target.value) })} /></label>
          <label className="field-label">Сдвиг Y<input type="number" value={selectedZone.offsetY} onChange={(event) => updateZone({ offsetY: Number(event.target.value) })} /></label>
        </div>
        {selectedZone.type === 'hex' && <label className="toggle-row"><input type="checkbox" checked={selectedZone.autoSize !== false} onChange={(event) => updateZone({ autoSize: event.target.checked })} /><span>Ширина ячейки как у квадратов</span></label>}
        <label className="field-label">Прозрачность<input type="range" min="0.05" max="1" step="0.05" value={selectedZone.opacity ?? map.grid.opacity} onChange={(event) => updateZone({ opacity: Number(event.target.value) })} /></label>
        <p className="hint">{selectedZone.type === 'hex' && selectedZone.autoSize !== false ? 'Размер вычисляется автоматически и меняется вместе с основной сеткой.' : 'Верхняя зона в списке перекрывает нижние.'}</p>
      </div>}
    </section>
  );
}

export function TablePanel({ state, send, upload, selectedEntityId, onSelectEntity, selectedZoneId, onSelectZone, onDrawZone, onDrawWall, settingsSection, onSettingsSection, library, importLibrary, refreshLibrary, onClear }) {
  const [cropFile, setCropFile] = useState(null);
  const [busy, setBusy] = useState('');
  const [localError, setLocalError] = useState('');
  const [showBlank, setShowBlank] = useState(false);
  const [blank, setBlank] = useState({ name: 'Новая карта', width: 1600, height: 1200, color: '#f2eadb' });
  const activePlacement = (state.placements || []).find((placement) => placement.id === state.activePlacementId && placement.tableId === state.activeTableId) || null;
  const map = state.maps.find((item) => item.id === activePlacement?.mapId) || null;
  const selectedEntity = state.entities.find((entity) => entity.id === selectedEntityId);

  const runUpload = async (kind, file, name, dimensions) => {
    setBusy(kind);
    setLocalError('');
    try {
      const item = await upload(kind, file, name, dimensions);
      if (kind === 'map') send('placeMap', { mapId: item.id, x: (state.placements?.length || 0) * 100, y: 0 });
    } catch (error) {
      setLocalError(error.message);
    } finally {
      setBusy('');
    }
  };

  const uploadMap = async (file) => {
    try {
      const dimensions = await imageDimensions(file);
      await runUpload('map', file, file.name.replace(/\.[^.]+$/, ''), dimensions);
    } catch { setLocalError('Не удалось прочитать изображение карты.'); }
  };
  const uploadObject = async (file) => {
    try {
      const dimensions = await imageDimensions(file);
      await runUpload('object', file, file.name.replace(/\.[^.]+$/, ''), dimensions);
    } catch { setLocalError('Не удалось прочитать изображение объекта.'); }
  };
  const addAsset = (asset) => {
    const offset = (state.entities.length % 6) * 24;
    const scale = activePlacement?.scale || 1;
    const centerX = (activePlacement?.x || 0) + (map?.width || 1200) * scale / 2;
    const centerY = (activePlacement?.y || 0) + (map?.height || 800) * scale / 2;
    send('addEntity', { assetId: asset.id, x: centerX + offset, y: centerY + offset, size: asset.kind === 'token' ? (map?.grid.size || 80) * scale : 120, name: asset.name });
  };
  const updateEntity = (patch) => send('updateEntity', { id: selectedEntity.id, patch });

  return (
    <div className="panel-scroll">
      <div className="table-actions"><button className="button secondary full-width" onClick={onClear}><Icon name="trash" />Очистить стол</button><span>Игроки останутся, действие можно отменить в истории.</span></div>
      {localError && <div className="inline-error">{localError}</div>}
      {selectedEntity && <section className="panel-section selected-entity-panel"><div className="section-heading"><div><span className="eyebrow">Выбрано на столе</span><h3>{selectedEntity.kind === 'token' ? 'Токен' : 'Объект'}</h3></div><button className="icon-button danger" onClick={() => { send('deleteEntity', { id: selectedEntity.id }); onSelectEntity(null); }}><Icon name="trash" /></button></div><label className="field-label">Имя<input value={selectedEntity.name} maxLength={60} onChange={(event) => updateEntity({ name: event.target.value })} /></label><div className="form-grid two-columns"><label className="field-label">Размер<input type="number" min="16" max="1000" value={selectedEntity.size} onChange={(event) => updateEntity({ size: Number(event.target.value) })} /></label><label className="field-label">Поворот, °<input type="number" min="-360" max="360" value={selectedEntity.rotation} onChange={(event) => updateEntity({ rotation: Number(event.target.value) })} /></label></div>{selectedEntity.kind === 'token' && <label className="field-label">Владелец<select value={selectedEntity.ownerId || ''} onChange={(event) => updateEntity({ ownerId: event.target.value || null })}><option value="">Только мастер</option>{state.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>}<p className="hint">{selectedEntity.kind === 'token' ? 'Токен привязывается к ячейке внутри карты.' : 'Объекты перемещаются свободно, без привязки.'}</p></section>}
      <section className="panel-section">
        <div className="section-heading"><div><span className="eyebrow">Основа стола</span><h3>Карты</h3></div><span className="count-badge">{state.maps.length}</span></div>
        <div className="button-grid"><FileButton accept="image/png,image/jpeg,image/webp,image/gif" onFile={uploadMap} disabled={Boolean(busy)}>{busy === 'map' ? 'Загрузка…' : 'Загрузить карту'}</FileButton><button className="button secondary" onClick={() => setShowBlank((value) => !value)}><Icon name="plus" />Создать карту</button></div>
        {showBlank && <div className="blank-map-form"><label className="field-label">Имя<input value={blank.name} maxLength={60} onChange={(event) => setBlank({ ...blank, name: event.target.value })} /></label><div className="form-grid two-columns"><label className="field-label">Ширина<input type="number" min="200" max="10000" value={blank.width} onChange={(event) => setBlank({ ...blank, width: Number(event.target.value) })} /></label><label className="field-label">Высота<input type="number" min="200" max="10000" value={blank.height} onChange={(event) => setBlank({ ...blank, height: Number(event.target.value) })} /></label></div><label className="color-row"><span>Цвет фона</span><input type="color" value={blank.color} onChange={(event) => setBlank({ ...blank, color: event.target.value })} /></label><button className="button primary full-width" disabled={!blank.name.trim()} onClick={() => { send('createBlankMap', blank); setShowBlank(false); }}><Icon name="check" />Создать</button></div>}
        <div className="asset-list">{state.maps.map((item) => <div key={item.id} className={`map-card ${item.id === activePlacement?.mapId ? 'selected' : ''}`}><button className="map-select" onClick={() => send('placeMap', { mapId: item.id, x: (state.placements?.length || 0) * 100, y: 0 })}><img src={item.url} alt="" /><span><strong>{item.name}</strong><small>{item.width} × {item.height}</small></span><Icon name="plus" /></button><button className="icon-button compact danger" onClick={() => send('deleteMap', { mapId: item.id })} title="Удалить карту"><Icon name="trash" size={14} /></button></div>)}</div>
        <LibraryPicker kind="map" items={library} onImport={importLibrary} onRefresh={refreshLibrary} onImported={(item) => send('placeMap', { mapId: item.id, x: (state.placements?.length || 0) * 100, y: 0 })} />
      </section>
      {(state.placements || []).some((placement) => placement.tableId === state.activeTableId) && <section className="panel-section"><div className="section-heading"><div><span className="eyebrow">Размещения</span><h3>Карты на столе</h3></div><span className="count-badge">{state.placements.filter((placement) => placement.tableId === state.activeTableId).length}</span></div><div className="zone-list">{state.placements.filter((placement) => placement.tableId === state.activeTableId).map((placement) => { const placedMap = state.maps.find((item) => item.id === placement.mapId); return <div className={`zone-row ${placement.id === state.activePlacementId ? 'selected' : ''}`} key={placement.id}><button className="zone-select" onClick={() => send('selectPlacement', { placementId: placement.id })}><Icon name="map" size={14} />{placedMap?.name || 'Карта'}</button><button className="icon-button compact danger" onClick={() => send('removePlacement', { id: placement.id })} title="Убрать со стола"><Icon name="close" size={14} /></button></div>; })}</div>{activePlacement && <div className="form-grid two-columns"><label className="field-label">X<input type="number" value={activePlacement.x} onChange={(event) => send('updatePlacement', { id: activePlacement.id, patch: { x: Number(event.target.value) } })} /></label><label className="field-label">Y<input type="number" value={activePlacement.y} onChange={(event) => send('updatePlacement', { id: activePlacement.id, patch: { y: Number(event.target.value) } })} /></label><label className="field-label">Масштаб<input type="number" min="0.05" max="20" step="0.05" value={activePlacement.scale} onChange={(event) => send('updatePlacement', { id: activePlacement.id, patch: { scale: Number(event.target.value) } })} /></label></div>}</section>}
      {map && <div className="settings-tabs"><button className={settingsSection === 'grid' ? 'active' : ''} onClick={() => onSettingsSection('grid')}><Icon name="grid" size={14} />Сетка</button><button className={settingsSection === 'vision' ? 'active' : ''} onClick={() => onSettingsSection('vision')}><Icon name="eye" size={14} />Зрение</button></div>}
      {map && settingsSection === 'vision' ? <VisionPanel map={map} send={send} onDrawWall={onDrawWall} /> : map && <GridSettings map={map} send={send} selectedZoneId={selectedZoneId} onSelectZone={onSelectZone} onDrawZone={onDrawZone} />}
      <section className="panel-section">
        <div className="section-heading"><div><span className="eyebrow">Библиотека</span><h3>Токены и объекты</h3></div></div>
        <div className="button-grid"><FileButton accept="image/png,image/jpeg,image/webp,image/gif" icon="token" onFile={setCropFile} disabled={Boolean(busy)}>Токен</FileButton><FileButton accept="image/png,image/jpeg,image/webp,image/gif" icon="box" onFile={uploadObject} disabled={Boolean(busy)}>{busy === 'object' ? 'Загрузка…' : 'Объект'}</FileButton></div>
        <p className="hint">Нажмите на изображение в библиотеке, чтобы положить его в центр карты.</p>
        <div className="asset-library">{state.assets.map((asset) => <div className="asset-card" key={asset.id}><button className="asset-add" onClick={() => addAsset(asset)} title={`Добавить: ${asset.name}`}><span className={`asset-preview ${asset.kind}`}><img src={asset.url} alt={asset.name} /></span><span className="asset-name">{asset.name}</span><small>{asset.kind === 'token' ? 'Токен' : 'Объект'}</small></button><button className="asset-delete icon-button compact danger" onClick={() => send('deleteAsset', { assetId: asset.id })} title="Удалить изображение"><Icon name="trash" size={12} /></button></div>)}</div>
        <LibraryPicker kind="token" items={library} onImport={importLibrary} onRefresh={refreshLibrary} />
        <LibraryPicker kind="object" items={library} onImport={importLibrary} onRefresh={refreshLibrary} />
      </section>
      {cropFile && <TokenCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={({ file, name, width, height }) => { setCropFile(null); runUpload('token', file, name, { width, height }); }} />}
    </div>
  );
}

export function TurnPanel({ state, send, isHost, onSelectEntity }) {
  const tokens = state.entities.filter((entity) => entity.kind === 'token' && entity.tableId === state.activeTableId);
  const turnOrder = state.turnOrder.filter((id) => tokens.some((token) => token.id === id));
  const missing = tokens.filter((token) => !turnOrder.includes(token.id));
  const reorder = (index, direction) => {
    const next = [...turnOrder];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    send('turn:setOrder', { ids: next });
  };
  return (
    <div className="panel-scroll">
      <section className="panel-section turn-section"><div className="section-heading"><div><span className="eyebrow">Инициатива</span><h3>Очередь хода</h3></div><span className="count-badge">{turnOrder.length}</span></div>
        {isHost && turnOrder.length > 0 && <><div className="turn-controls"><button className="button secondary" onClick={() => send('turn:step', { direction: -1 })}><Icon name="previous" />Предыдущий</button><button className="button primary" onClick={() => send('turn:step', { direction: 1 })}>Следующий<Icon name="next" /></button></div><button className="button secondary full-width" onClick={() => send('turn:setOrder', { ids: [] })}><Icon name="trash" />Очистить очередь</button></>}
        <div className="turn-list">{turnOrder.map((id, index) => {
          const token = tokens.find((entity) => entity.id === id);
          if (!token) return null;
          const active = state.currentTurn === id;
          return <div key={id} className={`turn-row ${active ? 'active' : ''}`}><button className="turn-main" onClick={() => { onSelectEntity(id); if (isHost) send('turn:set', { id }); }}><span className="turn-number">{index + 1}</span><span><strong>{token.name}</strong><small>{active ? 'Сейчас ходит' : 'Ожидает'}</small></span>{active && <span className="pulse-dot" />}</button>{isHost && <div className="turn-row-actions"><button className="icon-button compact" disabled={index === 0} onClick={() => reorder(index, -1)} title="Выше"><Icon name="chevronLeft" className="rotate-90" size={14} /></button><button className="icon-button compact" disabled={index === turnOrder.length - 1} onClick={() => reorder(index, 1)} title="Ниже"><Icon name="chevronRight" className="rotate-90" size={14} /></button><button className="icon-button compact" onClick={() => send('turn:setOrder', { ids: turnOrder.filter((item) => item !== id) })} title="Убрать"><Icon name="close" size={14} /></button></div>}</div>;
        })}</div>
        {turnOrder.length === 0 && <div className="empty-panel"><Icon name="token" size={32} /><p>Добавьте токены в очередь, чтобы отмечать текущий ход.</p></div>}
        {isHost && missing.length > 0 && <div className="available-tokens"><h4>Добавить в очередь</h4>{missing.map((token) => <button key={token.id} className="list-add-button" onClick={() => send('turn:setOrder', { ids: [...turnOrder, token.id] })}><Icon name="plus" size={15} /><span>{token.name}</span></button>)}</div>}
      </section>
    </div>
  );
}

export function PlayersPanel({ state, pendingPlayers, send, isHost, playerId, upload, library, importLibrary, refreshLibrary }) {
  return (
    <div className="panel-scroll"><section className="panel-section"><div className="section-heading"><div><span className="eyebrow">За этим столом</span><h3>Игроки</h3></div><span className="count-badge">{state.players.length + 1}</span></div><div className="player-row host"><span className="avatar"><Icon name="crown" /></span><span><strong>Мастер</strong><small>Управляет столом</small></span><span className="online-dot" /></div>{state.players.map((player) => <div className="player-row" key={player.id}><span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span><span><strong>{player.name}{player.id === playerId ? ' (вы)' : ''}</strong><small>{player.connected ? 'В сети' : 'Переподключается'}</small></span><span className={player.connected ? 'online-dot' : 'offline-dot'} />{isHost && <button className="icon-button danger" onClick={() => send('removePlayer', { playerId: player.id })} title="Удалить игрока"><Icon name="close" /></button>}</div>)}</section>{isHost && pendingPlayers.length > 0 && <section className="panel-section requests-section"><div className="section-heading"><div><span className="eyebrow">Ждут разрешения</span><h3>Заявки</h3></div><span className="count-badge attention">{pendingPlayers.length}</span></div>{pendingPlayers.map((player) => <div className="request-row" key={player.id}><span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span><strong>{player.name}</strong><div><button className="icon-button success" onClick={() => send('approvePlayer', { playerId: player.id })} title="Принять"><Icon name="check" /></button><button className="icon-button danger" onClick={() => send('rejectPlayer', { playerId: player.id })} title="Отклонить"><Icon name="close" /></button></div></div>)}</section>}{!isHost && <PlayerTokensPanel upload={upload} library={library} importLibrary={importLibrary} refreshLibrary={refreshLibrary} />}{isHost && <p className="panel-footer-hint">Игроки подключаются по LAN-адресу, который сервер вывел в терминале. Им не нужно устанавливать приложение.</p>}</div>
  );
}
