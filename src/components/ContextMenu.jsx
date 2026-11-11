import React, { useState } from 'react';
import Icon from './Icon.jsx';

export default function ContextMenu({ menu, state, isHost, onAction, onClose }) {
  const [section, setSection] = useState(null);
  if (!menu) return null;
  const entity = state.entities.find((item) => item.id === menu.entityId);
  const assets = section === 'map' ? state.maps : state.assets.filter((asset) => asset.kind === section);
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 260));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 410));
  const action = (type, payload = {}) => onAction(type, payload);
  const mainAction = (type, payload = {}) => action(type, payload);

  return (
    <div className="context-menu" style={{ left, top }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      {section ? <>
        <button className="context-back" onClick={() => setSection(null)}><Icon name="chevronLeft" size={14} />Назад</button>
        <div className="context-assets">{assets.map((item) => <button key={item.id} onClick={() => mainAction(section === 'map' ? 'placeMap' : 'addEntity', { id: item.id, point: menu.point })}>{section === 'map' ? <Icon name="map" /> : <Icon name={item.kind === 'token' ? 'token' : 'box'} />}<span>{item.name}</span></button>)}{!assets.length && <p>Библиотека пуста</p>}</div>
      </> : entity ? <>
        <div className="context-title">{entity.name}</div>
        <button onClick={() => mainAction('entitySettings', { id: entity.id })}><Icon name="edit" />Настроить</button>
        {entity.kind === 'token' && !state.turnOrder.includes(entity.id) && <button onClick={() => mainAction('addTurn', { id: entity.id })}><Icon name="plus" />В очередь</button>}
        <button className="danger" onClick={() => mainAction('deleteEntity', { id: entity.id })}><Icon name="trash" />Удалить</button>
      </> : <>
        <button onClick={() => setSection('token')}><Icon name="token" />Добавить токен<Icon name="chevronRight" size={13} /></button>
        {isHost && <button onClick={() => setSection('object')}><Icon name="box" />Добавить объект<Icon name="chevronRight" size={13} /></button>}
        {isHost && <button onClick={() => setSection('map')}><Icon name="map" />Добавить карту<Icon name="chevronRight" size={13} /></button>}
        {isHost && menu.placementId && <div className="context-separator" />}
        {isHost && menu.placementId && <button onClick={() => mainAction('gridSettings')}><Icon name="grid" />Сетка</button>}
        {isHost && menu.placementId && <button onClick={() => mainAction('visionSettings')}><Icon name="eye" />Зрение</button>}
        {isHost && menu.placementId && <button onClick={() => mainAction('moveMap')}><Icon name="move" />Переместить карту</button>}
        {isHost && menu.placementId && <button className="danger" onClick={() => mainAction('removeMap')}><Icon name="trash" />Убрать карту</button>}
      </>}
      <button className="context-close" onClick={onClose} title="Закрыть"><Icon name="close" size={13} /></button>
    </div>
  );
}
