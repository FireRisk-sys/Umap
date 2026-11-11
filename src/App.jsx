import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useTable from './lib/useTable.js';
import Board from './components/Board.jsx';
import Icon from './components/Icon.jsx';
import { PlayersPanel, TablePanel, TurnPanel } from './components/Panels.jsx';
import { MusicPanel, SoundsPanel } from './components/MediaPanel.jsx';
import AudioManager from './components/AudioManager.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';

const hostTabs = [
  { id: 'table', label: 'Стол', icon: 'map' },
  { id: 'history', label: 'История', icon: 'repeat' },
  { id: 'turn', label: 'Ход', icon: 'token' },
  { id: 'players', label: 'Игроки', icon: 'users' },
  { id: 'music', label: 'Музыка', icon: 'music' },
  { id: 'sounds', label: 'Звуки', icon: 'volume' },
];
const playerTabs = hostTabs.filter((tab) => ['turn', 'players', 'music'].includes(tab.id));

function JoinScreen({ onJoin, status, error }) {
  const [name, setName] = useState(localStorage.getItem('umap.playerName') || '');
  const submit = (event) => {
    event.preventDefault();
    localStorage.setItem('umap.playerName', name.trim());
    onJoin(name);
  };
  if (status === 'pending') return (
    <div className="join-screen"><div className="join-card waiting-card"><div className="waiting-rune"><Icon name="users" size={36} /></div><span className="eyebrow">Заявка отправлена</span><h1>Место за столом почти готово</h1><p>Мастер видит вашу заявку. Страница откроется автоматически после одобрения.</p><div className="loading-line"><span /></div></div></div>
  );
  return (
    <div className="join-screen"><div className="join-decoration"><Icon name="map" size={54} /><span>UMAP</span></div><form className="join-card" onSubmit={submit}><span className="eyebrow">Локальная игровая сессия</span><h1>Займите место за столом</h1><p>Введите имя персонажа или игрока. Мастер получит заявку и впустит вас в игру.</p><label className="field-label">Ваше имя<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Элирон" minLength={1} maxLength={40} required autoFocus /></label>{error && <div className="inline-error">{error}</div>}<button className="button primary large" disabled={status === 'connecting'}>{status === 'connecting' ? 'Подключение…' : status === 'closed' ? 'Подключиться к новой игре' : 'Попроситься за стол'}<Icon name="chevronRight" /></button><small className="join-note">Ничего устанавливать не нужно — игра работает в браузере.</small></form></div>
  );
}

export default function App() {
  const isHost = new URLSearchParams(location.search).get('host') === '1';
  const table = useTable(isHost);
  const { state, role, status, send } = table;
  const [activeTab, setActiveTab] = useState(isHost ? 'table' : 'turn');
  const [editorMode, setEditorMode] = useState('select');
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const [settingsSection, setSettingsSection] = useState('grid');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [localVolume, setLocalVolume] = useState(() => Number(localStorage.getItem('umap.volume') ?? 1));
  const [copied, setCopied] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [library, setLibrary] = useState([]);
  const isReady = status === 'ready' && state;
  const tabs = role === 'host' ? hostTabs : playerTabs;
  const currentToken = state?.entities.find((entity) => entity.id === state.currentTurn && entity.tableId === state.activeTableId);
  const player = state?.players.find((item) => item.id === table.playerId);
  const activeTitle = useMemo(() => tabs.find((tab) => tab.id === activeTab)?.label || '', [tabs, activeTab]);
  const openSettings = useCallback((section, placementId) => {
    setActiveTab('table');
    setSettingsSection(section);
    if (placementId) send('selectPlacement', { placementId });
  }, [send]);

  const refreshLibrary = useCallback(async () => {
    if (status !== 'ready') return;
    try {
      setLibrary(await table.getLibrary());
    } catch { /* The next scheduled refresh will retry. */ }
  }, [status, table.getLibrary]);

  useEffect(() => {
    localStorage.setItem('umap.volume', String(localVolume));
  }, [localVolume]);

  useEffect(() => {
    if (!isReady) return;
    refreshLibrary();
    const interval = setInterval(refreshLibrary, 5000);
    return () => clearInterval(interval);
  }, [isReady, refreshLibrary]);

  useEffect(() => {
    if (role === 'player' && !playerTabs.some((tab) => tab.id === activeTab)) setActiveTab('turn');
  }, [role, activeTab]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (role !== 'host' || !isReady || confirmAction) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        send(event.shiftKey ? 'history:redo' : 'history:undo');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        send('history:redo');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [role, isReady, confirmAction, send]);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(location.origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* Clipboard can be unavailable on insecure LAN origins. */ }
  };

  if (status === 'closed' && isHost) return (
    <div className="join-screen"><div className="join-card waiting-card"><div className="waiting-rune"><Icon name="check" size={36} /></div><span className="eyebrow">Сессия завершена</span><h1>Стол собран и очищен</h1><p>Игроки отключены, временные загрузки удалены. Локальная библиотека сохранена. Можно начать новую игру без перезапуска сервера.</p><button className="button primary large" onClick={table.startNewSession}>Начать новую сессию<Icon name="chevronRight" /></button></div></div>
  );
  if (!isHost && !isReady) return <JoinScreen onJoin={table.join} status={status} error={table.error} />;
  if (!isReady) return <div className="loading-screen"><div className="brand-mark"><Icon name="map" size={34} /></div><h1>Раскладываем стол…</h1><p>{table.error || 'Подключаемся к локальной игровой сессии'}</p></div>;

  const mediaProps = { library, importLibrary: table.importLibrary, refreshLibrary };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><span className="brand-mark"><Icon name="map" size={25} /></span><span><strong>UMap</strong><small>VIRTUAL TABLETOP</small></span></div>
        <div className="session-info"><span className={`connection-dot ${status}`} /><span>{role === 'host' ? 'Локальная сессия' : `Вы: ${player?.name || 'Игрок'}`}</span>{role === 'host' && <button className="invite-button" onClick={copyInvite}><Icon name={copied ? 'check' : 'link'} size={14} />{copied ? 'Скопировано' : 'Пригласить'}</button>}</div>
        {currentToken && <div className="header-turn"><span className="pulse-dot" /><span>Ходит</span><strong>{currentToken.name}</strong></div>}
        <button className={`header-audio ${audioEnabled ? 'enabled' : ''}`} onClick={() => setAudioEnabled((value) => !value)} title="Общий звук в этом браузере"><Icon name="volume" /><span>{audioEnabled ? 'Звук вкл.' : 'Звук выкл.'}</span></button>
        {role === 'host' && <button className="close-session" onClick={() => setConfirmAction('close')} title="Закрыть игровую сессию"><Icon name="stop" size={15} /><span>Закрыть</span></button>}
      </header>
      <div className="workspace">
        <Board state={state} role={role} playerId={table.playerId} send={send} editorMode={editorMode} setEditorMode={setEditorMode} selectedEntityId={selectedEntityId} onSelectEntity={setSelectedEntityId} selectedZoneId={selectedZoneId} onSelectZone={setSelectedZoneId} onOpenSettings={openSettings} />
        <aside className="side-panel">
          <div className="mobile-panel-heading"><span>{activeTitle}</span></div>
          {activeTab === 'table' && role === 'host' && <TablePanel state={state} send={send} upload={table.upload} selectedEntityId={selectedEntityId} onSelectEntity={setSelectedEntityId} selectedZoneId={selectedZoneId} onSelectZone={setSelectedZoneId} onDrawZone={() => setEditorMode('zone')} onDrawWall={() => setEditorMode('vision')} settingsSection={settingsSection} onSettingsSection={setSettingsSection} onClear={() => setConfirmAction('reset')} {...mediaProps} />}
          {activeTab === 'history' && role === 'host' && <HistoryPanel history={table.history} send={send} />}
          {activeTab === 'turn' && <TurnPanel state={state} send={send} isHost={role === 'host'} onSelectEntity={setSelectedEntityId} />}
          {activeTab === 'players' && <PlayersPanel state={state} pendingPlayers={table.pendingPlayers} send={send} isHost={role === 'host'} playerId={table.playerId} upload={table.upload} {...mediaProps} />}
          {activeTab === 'music' && <MusicPanel music={state.music} send={send} upload={table.upload} isHost={role === 'host'} audioEnabled={audioEnabled} localVolume={localVolume} onVolumeChange={setLocalVolume} onEnableAudio={() => setAudioEnabled((value) => !value)} {...mediaProps} />}
          {activeTab === 'sounds' && role === 'host' && <SoundsPanel sounds={state.sounds} send={send} upload={table.upload} audioEnabled={audioEnabled} onEnableAudio={() => setAudioEnabled((value) => !value)} {...mediaProps} />}
        </aside>
      </div>
      <nav className="side-nav" aria-label="Разделы стола">{tabs.map((tab) => <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}><span className="nav-icon"><Icon name={tab.icon} size={20} />{tab.id === 'players' && table.pendingPlayers.length > 0 && <i className="nav-badge">{table.pendingPlayers.length}</i>}</span><span>{tab.label}</span></button>)}</nav>
      <AudioManager music={state.music} sounds={state.sounds} send={send} lastEvent={table.lastEvent} enabled={audioEnabled} localVolume={localVolume} />
      {table.error && <button className="toast error-toast" onClick={table.clearError}>{table.error}<Icon name="close" size={16} /></button>}
      {status === 'disconnected' && <div className="reconnect-banner">Связь потеряна. Восстанавливаем вашего игрока…</div>}
      {confirmAction && <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal confirm-modal"><div className="modal-heading"><div><span className="eyebrow">Подтверждение</span><h2>{confirmAction === 'close' ? 'Закрыть сессию?' : 'Очистить стол?'}</h2></div><button className="icon-button" onClick={() => setConfirmAction(null)}><Icon name="close" /></button></div><p>{confirmAction === 'close' ? 'Все игроки будут отключены. Карты, токены, музыка, история и временные загрузки будут удалены без возможности отмены. Файлы в папке library сохранятся.' : 'Карты, сетки, токены, объекты и медиа будут убраны со стола. Игроки останутся подключёнными. Очистку можно отменить через историю.'}</p><div className="modal-actions"><button className="button secondary" onClick={() => setConfirmAction(null)}>Отмена</button><button className="button danger-button" onClick={() => { send(confirmAction === 'close' ? 'session:close' : 'table:reset'); setConfirmAction(null); }}>{confirmAction === 'close' ? 'Закрыть для всех' : 'Очистить стол'}</button></div></div></div>}
    </div>
  );
}
