import React, { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import LibraryPicker from './LibraryPicker.jsx';

export function MusicPanel({ music, send, upload, isHost, audioEnabled, localVolume = 1, onVolumeChange, onEnableAudio, library, importLibrary, refreshLibrary }) {
  const fileRef = useRef(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [trackName, setTrackName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = music.tracks.find((track) => track.id === music.currentId);
  const control = (action, extra = {}) => send('music:control', { action, ...extra });
  const addYoutube = (event) => {
    event.preventDefault();
    if (!youtubeUrl.trim()) return;
    send('music:addYouTube', { url: youtubeUrl.trim(), name: trackName.trim() || 'YouTube-трек' });
    setYoutubeUrl('');
    setTrackName('');
  };
  const uploadAudio = async (file) => {
    setBusy(true);
    setError('');
    try { await upload('audio', file, file.name.replace(/\.[^.]+$/, '')); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const stop = () => { control('pause'); control('seek', { value: 0 }); };

  return (
    <div className="panel-scroll media-panel">
      <section className="panel-section player-section">
        <div className="section-heading"><div><span className="eyebrow">Общий для всех</span><h3>Музыкальный плеер</h3></div><button className={`sound-toggle ${audioEnabled ? 'enabled' : ''}`} onClick={onEnableAudio}><Icon name="volume" size={16} />{audioEnabled ? 'Звук включён' : 'Включить звук'}</button></div>
        <div className="now-playing"><span className="now-playing-icon"><Icon name={current?.type === 'youtube' ? 'link' : 'music'} size={24} /></span><div><small>{music.playing ? 'Сейчас играет' : 'Плеер остановлен'}</small><strong>{current?.name || 'Выберите трек в очереди'}</strong></div><span className={`equalizer ${music.playing && audioEnabled ? 'playing' : ''}`}><i /><i /><i /></span></div>
        <div className="player-controls"><button className="icon-button" onClick={() => control('previous')} disabled={!music.tracks.length} title="Предыдущий трек"><Icon name="previous" /></button><button className="play-button" onClick={() => control(music.playing ? 'pause' : 'play')} disabled={!music.tracks.length} title={music.playing ? 'Пауза' : 'Играть'}><Icon name={music.playing ? 'pause' : 'play'} size={24} /></button><button className="icon-button" onClick={stop} disabled={!current} title="Остановить"><Icon name="stop" /></button><button className="icon-button" onClick={() => control('next')} disabled={!music.tracks.length} title="Следующий трек"><Icon name="next" /></button><button className={`icon-button ${music.repeat !== 'off' ? 'accent' : ''}`} onClick={() => control('repeat', { value: music.repeat === 'off' ? 'all' : music.repeat === 'all' ? 'one' : 'off' })} title={`Повтор: ${music.repeat === 'off' ? 'выключен' : music.repeat === 'all' ? 'очередь' : 'один трек'}`}><Icon name="repeat" />{music.repeat === 'one' && <span className="repeat-one">1</span>}</button></div>
        <label className="volume-row" title="Моя громкость"><Icon name="volume" /><input type="range" min="0" max="1" step="0.01" value={localVolume} onChange={(event) => onVolumeChange(Number(event.target.value))} /><span>{Math.round(localVolume * 100)}%</span></label>
        {!audioEnabled && <p className="hint">Браузеры разрешают звук только после нажатия кнопки. Это нужно сделать каждому игроку.</p>}
      </section>
      <section className="panel-section"><div className="section-heading"><div><span className="eyebrow">Добавить музыку</span><h3>Новый трек</h3></div></div><input ref={fileRef} hidden type="file" accept="audio/*" onChange={(event) => { if (event.target.files?.[0]) uploadAudio(event.target.files[0]); event.target.value = ''; }} /><button className="button secondary full-width" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" />{busy ? 'Загрузка…' : 'Загрузить аудиофайл'}</button><div className="divider"><span>или ссылка на YouTube</span></div><form onSubmit={addYoutube} className="youtube-form"><label className="field-label">Название (необязательно)<input value={trackName} onChange={(event) => setTrackName(event.target.value)} maxLength={100} placeholder="Таверна у тракта" /></label><div className="input-action"><input type="url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://youtube.com/watch?v=…" required /><button className="button primary" type="submit" title="Добавить"><Icon name="plus" /></button></div></form>{error && <div className="inline-error">{error}</div>}<LibraryPicker kind="audio" items={library} onImport={importLibrary} onRefresh={refreshLibrary} /></section>
      <section className="panel-section"><div className="section-heading"><div><span className="eyebrow">Плейлист стола</span><h3>Очередь</h3></div><span className="count-badge">{music.tracks.length}</span></div><div className="track-list">{music.tracks.map((track, index) => <div key={track.id} className={`track-row ${track.id === music.currentId ? 'active' : ''}`}><button className="track-main" onClick={() => { control('select', { trackId: track.id }); control('play'); }}><span className="track-index">{track.id === music.currentId && music.playing ? <Icon name="volume" size={16} /> : String(index + 1).padStart(2, '0')}</span><span><strong>{track.name}</strong><small>{track.type === 'youtube' ? 'YouTube' : 'Аудиофайл'}</small></span></button>{isHost && <button className="icon-button compact danger" onClick={() => send('music:remove', { trackId: track.id })} title="Удалить трек"><Icon name="trash" size={15} /></button>}</div>)}</div>{!music.tracks.length && <div className="empty-panel"><Icon name="music" size={30} /><p>Загрузите атмосферную музыку или добавьте ссылку на YouTube.</p></div>}</section>
    </div>
  );
}

export function SoundsPanel({ sounds, send, upload, audioEnabled, onEnableAudio, library, importLibrary, refreshLibrary }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [volumes, setVolumes] = useState({});
  const addSound = async (file) => {
    setBusy(true);
    setError('');
    try { await upload('sound', file, file.name.replace(/\.[^.]+$/, '')); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="panel-scroll media-panel">
      <section className="panel-section"><div className="section-heading"><div><span className="eyebrow">Пульт мастера</span><h3>Звуковые эффекты</h3></div><button className={`sound-toggle ${audioEnabled ? 'enabled' : ''}`} onClick={onEnableAudio}><Icon name="volume" size={16} />{audioEnabled ? 'Звук включён' : 'Включить звук'}</button></div><p className="hint">Нажатие запускает эффект у всех игроков. Музыкальная очередь не меняется.</p><input ref={fileRef} hidden type="file" accept="audio/*" onChange={(event) => { if (event.target.files?.[0]) addSound(event.target.files[0]); event.target.value = ''; }} /><button className="button secondary full-width" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="upload" />{busy ? 'Загрузка…' : 'Загрузить звук'}</button>{error && <div className="inline-error">{error}</div>}<LibraryPicker kind="sound" items={library} onImport={importLibrary} onRefresh={refreshLibrary} /></section>
      <section className="panel-section"><div className="section-heading"><h3>Библиотека звуков</h3><span className="count-badge">{sounds.length}</span></div><div className="sound-grid">{sounds.map((sound) => <div className="sound-card" key={sound.id}><button className="sound-play" onClick={() => send('sound:play', { soundId: sound.id, volume: volumes[sound.id] ?? 0.8 })}><Icon name="play" size={22} /></button><strong>{sound.name}</strong><button className="sound-delete icon-button compact danger" onClick={() => send('deleteSound', { soundId: sound.id })} title="Удалить звук"><Icon name="trash" size={13} /></button><label className="volume-row"><Icon name="volume" size={14} /><input type="range" min="0" max="1" step="0.05" value={volumes[sound.id] ?? 0.8} onChange={(event) => setVolumes({ ...volumes, [sound.id]: Number(event.target.value) })} /></label></div>)}</div>{!sounds.length && <div className="empty-panel"><Icon name="volume" size={30} /><p>Добавьте удары меча, шаги, дождь или заклинания.</p></div>}{sounds.length > 0 && <button className="button secondary full-width stop-sounds" onClick={() => send('sound:stop')}><Icon name="stop" />Остановить все эффекты</button>}</section>
    </div>
  );
}
