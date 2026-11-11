import React from 'react';
import Icon from './Icon.jsx';

export default function HistoryPanel({ history, send }) {
  const items = [...history.items].reverse();
  return (
    <div className="panel-scroll">
      <section className="panel-section">
        <div className="section-heading"><div><span className="eyebrow">До 50 последних изменений</span><h3>История действий</h3></div><Icon name="repeat" /></div>
        <div className="turn-controls"><button className="button secondary" disabled={!history.canUndo} onClick={() => send('history:undo')}><Icon name="previous" />Отменить</button><button className="button secondary" disabled={!history.canRedo} onClick={() => send('history:redo')}>Повторить<Icon name="next" /></button></div>
        <p className="hint">Ctrl+Z — отменить ошибочную сетку или другое действие. Ctrl+Y — вернуть его обратно. Подключение игроков и управление громкостью не записываются.</p>
      </section>
      <section className="panel-section">
        <div className="section-heading"><h3>Последние действия</h3><span className="count-badge">{items.length}</span></div>
        <div className="history-list">{items.map((item, index) => <div className="history-row" key={item.id}><span className="history-index">{items.length - index}</span><span><strong>{item.label}</strong><small>{new Date(item.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small></span>{index === 0 && <span className="history-latest">Последнее</span>}</div>)}</div>
        {!items.length && <div className="empty-panel"><Icon name="repeat" size={30} /><p>Изменения карт, сетки, токенов и очереди появятся здесь.</p></div>}
      </section>
    </div>
  );
}
