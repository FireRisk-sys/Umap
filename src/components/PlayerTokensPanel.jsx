import React, { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import TokenCropper from './TokenCropper.jsx';
import LibraryPicker from './LibraryPicker.jsx';

export default function PlayerTokensPanel({ upload, library, importLibrary, refreshLibrary }) {
  const fileRef = useRef(null);
  const [cropFile, setCropFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const addToken = async ({ file, name, width, height }) => {
    setBusy(true);
    setError('');
    try { await upload('token', file, name, { width, height }); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  return (
    <section className="panel-section">
      <div className="section-heading"><div><span className="eyebrow">Ваши инструменты</span><h3>Мои токены</h3></div><Icon name="token" /></div>
      <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { if (event.target.files?.[0]) setCropFile(event.target.files[0]); event.target.value = ''; }} />
      <button className="button secondary full-width" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="upload" />{busy ? 'Загрузка…' : 'Загрузить токен'}</button>
      <p className="hint">После добавления нажмите ПКМ по столу и выберите токен. Он будет принадлежать вам.</p>
      <LibraryPicker kind="token" items={library} onImport={importLibrary} onRefresh={refreshLibrary} />
      {error && <div className="inline-error">{error}</div>}
      {cropFile && <TokenCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={(result) => { setCropFile(null); addToken(result); }} />}
    </section>
  );
}
