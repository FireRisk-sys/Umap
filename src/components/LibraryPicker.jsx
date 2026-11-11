import React, { useState } from 'react';
import Icon from './Icon.jsx';

const folders = { map: 'maps', token: 'tokens', object: 'objects', audio: 'music', sound: 'sounds' };

async function dimensionsFromUrl(url) {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = url;
  });
  return { width: image.naturalWidth, height: image.naturalHeight };
}

export default function LibraryPicker({ kind, items, onImport, onRefresh, onImported }) {
  const [busyFile, setBusyFile] = useState('');
  const [error, setError] = useState('');
  const files = items.filter((item) => item.kind === kind);
  const importFile = async (file) => {
    setBusyFile(file.fileName);
    setError('');
    try {
      const dimensions = ['map', 'token', 'object'].includes(kind) ? await dimensionsFromUrl(file.url) : {};
      const item = await onImport(kind, file, dimensions);
      onImported?.(item, kind);
    } catch (reason) {
      setError(reason.message || 'Не удалось добавить файл.');
    } finally {
      setBusyFile('');
    }
  };

  return (
    <div className="library-picker">
      <div className="subsection-heading"><div><h4>Файлы на компьютере</h4><code className="library-path">library/{folders[kind]}/</code></div><button className="icon-button compact" onClick={onRefresh} title="Обновить список"><Icon name="repeat" size={14} /></button></div>
      {files.length > 0 ? <div className="library-files">{files.map((file) => <div className="library-file" key={file.fileName}><span title={file.fileName}>{file.name}</span><button className="button tiny secondary" disabled={Boolean(busyFile)} onClick={() => importFile(file)}>{busyFile === file.fileName ? 'Добавление…' : <><Icon name="plus" size={13} />Добавить</>}</button></div>)}</div> : <p className="hint">Положите файлы в эту папку на компьютере хоста — они появятся здесь автоматически.</p>}
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
}
