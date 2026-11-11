import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const PREVIEW_SIZE = 340;
const OUTPUT_SIZE = 512;

export default function TokenCropper({ file, onCancel, onConfirm }) {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const [imageUrl, setImageUrl] = useState('');
  const [name, setName] = useState(file.name.replace(/\.[^.]+$/, ''));
  const [circular, setCircular] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setLoaded(true);
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    offsetRef.current = offset;
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    context.fillStyle = '#17130f';
    context.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    const scale = Math.max(PREVIEW_SIZE / image.width, PREVIEW_SIZE / image.height) * zoom;
    const width = image.width * scale;
    const height = image.height * scale;
    context.save();
    if (circular) {
      context.beginPath();
      context.arc(PREVIEW_SIZE / 2, PREVIEW_SIZE / 2, PREVIEW_SIZE / 2 - 2, 0, Math.PI * 2);
      context.clip();
    }
    context.drawImage(image, (PREVIEW_SIZE - width) / 2 + offset.x, (PREVIEW_SIZE - height) / 2 + offset.y, width, height);
    context.restore();
    if (circular) {
      context.strokeStyle = '#d6ae64';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(PREVIEW_SIZE / 2, PREVIEW_SIZE / 2, PREVIEW_SIZE / 2 - 2, 0, Math.PI * 2);
      context.stroke();
    }
  }, [loaded, zoom, offset, circular]);

  const pointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, offset: offsetRef.current };
  };

  const pointerMove = (event) => {
    if (!dragRef.current) return;
    const next = {
      x: dragRef.current.offset.x + event.clientX - dragRef.current.x,
      y: dragRef.current.offset.y + event.clientY - dragRef.current.y,
    };
    offsetRef.current = next;
    setOffset(next);
  };

  const confirm = async () => {
    if (!imageRef.current || !name.trim()) return;
    if (!circular) {
      onConfirm({ file, name: name.trim(), width: imageRef.current.width, height: imageRef.current.height });
      return;
    }
    const output = document.createElement('canvas');
    output.width = OUTPUT_SIZE;
    output.height = OUTPUT_SIZE;
    const context = output.getContext('2d');
    const image = imageRef.current;
    const ratio = OUTPUT_SIZE / PREVIEW_SIZE;
    const scale = Math.max(PREVIEW_SIZE / image.width, PREVIEW_SIZE / image.height) * zoom * ratio;
    const width = image.width * scale;
    const height = image.height * scale;
    context.beginPath();
    context.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    context.clip();
    context.drawImage(image, (OUTPUT_SIZE - width) / 2 + offset.x * ratio, (OUTPUT_SIZE - height) / 2 + offset.y * ratio, width, height);
    const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/png'));
    onConfirm({
      file: new File([blob], `${name.trim()}.png`, { type: 'image/png' }),
      name: name.trim(),
      width: OUTPUT_SIZE,
      height: OUTPUT_SIZE,
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Настройка токена">
      <div className="modal cropper-modal">
        <div className="modal-heading">
          <div><span className="eyebrow">Новый токен</span><h2>Кадрирование</h2></div>
          <button className="icon-button" onClick={onCancel} title="Закрыть"><Icon name="close" /></button>
        </div>
        <canvas
          ref={canvasRef}
          className={`crop-canvas ${circular ? 'is-circular' : ''}`}
          width={PREVIEW_SIZE}
          height={PREVIEW_SIZE}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
        />
        <label className="field-label">Имя токена<input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} autoFocus /></label>
        <label className="toggle-row"><input type="checkbox" checked={circular} onChange={(event) => setCircular(event.target.checked)} /><span>Обрезать в круг</span></label>
        <label className="field-label">Масштаб <span className="field-value">{Math.round(zoom * 100)}%</span><input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <p className="hint">Перетаскивайте изображение, чтобы выбрать видимую область.</p>
        <div className="modal-actions"><button className="button secondary" onClick={onCancel}>Отмена</button><button className="button primary" disabled={!loaded || !name.trim()} onClick={confirm}><Icon name="check" /> Добавить токен</button></div>
      </div>
    </div>
  );
}
