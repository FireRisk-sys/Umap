import React from 'react';
import Icon from './Icon.jsx';

export default function VisionPanel({ map, send, onDrawWall }) {
  const vision = map.vision || { enabled: false, range: 800, rays: 120, opacity: 0.9 };
  const walls = map.walls || [];
  const update = (patch) => send('updateMap', { mapId: map.id, patch: { vision: { ...vision, ...patch } } });
  return (
    <section className="panel-section">
      <div className="section-heading"><div><span className="eyebrow">Свет и преграды</span><h3>Поле зрения</h3></div><Icon name="eye" /></div>
      <label className="toggle-row"><input type="checkbox" checked={vision.enabled} onChange={(event) => update({ enabled: event.target.checked })} /><span>Включить для игроков</span></label>
      <p className="hint">Хост видит всю карту. Игроки — только области вокруг токенов.</p>
      <div className="form-grid two-columns">
        <label className="field-label">Радиус<input type="number" min="10" max="100000" value={vision.range} onChange={(event) => update({ range: Number(event.target.value) })} /></label>
        <label className="field-label">Лучи<input type="number" min="24" max="720" step="12" value={vision.rays} onChange={(event) => update({ rays: Number(event.target.value) })} /></label>
      </div>
      <label className="field-label">Затемнение <span className="field-value">{Math.round(vision.opacity * 100)}%</span><input type="range" min="0.1" max="1" step="0.05" value={vision.opacity} onChange={(event) => update({ opacity: Number(event.target.value) })} /></label>
      <div className="subsection-heading"><h4>Преграды <span className="count-badge">{walls.length}</span></h4><button className="button tiny secondary" onClick={onDrawWall}><Icon name="plus" size={14} />Добавить</button></div>
      <p className="hint">Потяните для прямоугольника или кликайте по точкам. В обычном режиме преграды невидимы.</p>
      <div className="zone-list">{walls.map((wall) => <div className="zone-row" key={wall.id}><span className="zone-select">{wall.name}</span><button className="icon-button compact danger" onClick={() => send('updateMap', { mapId: map.id, patch: { walls: walls.filter((item) => item.id !== wall.id) } })} title="Удалить преграду"><Icon name="trash" size={14} /></button></div>)}</div>
      {walls.length > 0 && <button className="button secondary full-width" onClick={() => send('updateMap', { mapId: map.id, patch: { walls: [] } })}><Icon name="trash" />Удалить все</button>}
    </section>
  );
}
