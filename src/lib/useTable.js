import { useCallback, useEffect, useRef, useState } from 'react';

const PLAYER_KEY = 'umap.playerId';
const HOST_KEY = 'umap.hostKey';
const PLAYER_NAME = 'umap.playerName';
const EMPTY_HISTORY = { canUndo: false, canRedo: false, items: [] };

for (const key of [PLAYER_KEY, HOST_KEY, PLAYER_NAME]) {
  const legacyKey = key.replace('umap.', 'newmap.');
  const legacyValue = localStorage.getItem(legacyKey);
  if (!localStorage.getItem(key) && legacyValue) localStorage.setItem(key, legacyValue);
}

export default function useTable(isHost) {
  const socketRef = useRef(null);
  const reconnectRef = useRef(null);
  const hostKeyRef = useRef(localStorage.getItem(HOST_KEY) || '');
  const joinRef = useRef(null);
  const mountedRef = useRef(true);
  const [state, setState] = useState(null);
  const [pendingPlayers, setPendingPlayers] = useState([]);
  const [history, setHistory] = useState(EMPTY_HISTORY);
  const [role, setRole] = useState(null);
  const [playerId, setPlayerId] = useState(localStorage.getItem(PLAYER_KEY) || null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [lastEvent, setLastEvent] = useState(null);

  const connect = useCallback(() => {
    if (!mountedRef.current || !joinRef.current) return;
    if (socketRef.current && socketRef.current.readyState < WebSocket.CLOSING) return;
    clearTimeout(reconnectRef.current);
    setStatus((current) => (current === 'pending' ? current : 'connecting'));
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}`);
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      if (socketRef.current !== socket) return;
      const payload = joinRef.current;
      socket.send(JSON.stringify(payload.hostKey
        ? { type: 'hello', hostKey: payload.hostKey }
        : { type: 'hello', name: payload.name, playerId: payload.playerId }));
    });

    socket.addEventListener('message', (event) => {
      if (socketRef.current !== socket) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'welcome') {
        setRole(message.role);
        setState(message.state);
        setPendingPlayers(message.pendingPlayers || []);
        setHistory(message.history || EMPTY_HISTORY);
        setStatus('ready');
        setError('');
        if (message.playerId) {
          setPlayerId(message.playerId);
          localStorage.setItem(PLAYER_KEY, message.playerId);
          if (joinRef.current) joinRef.current.playerId = message.playerId;
        }
      } else if (message.type === 'state') {
        setState(message.state);
        setPendingPlayers(message.pendingPlayers || []);
        if (message.history) setHistory(message.history);
      } else if (message.type === 'pending') {
        setStatus('pending');
        setPlayerId(message.playerId);
        localStorage.setItem(PLAYER_KEY, message.playerId);
        if (joinRef.current) joinRef.current.playerId = message.playerId;
      } else if (message.type === 'rejected') {
        setStatus('rejected');
        setError(message.message || 'Хост отклонил заявку.');
        localStorage.removeItem(PLAYER_KEY);
        setPlayerId(null);
        if (joinRef.current) joinRef.current.playerId = null;
      } else if (message.type === 'session:closed') {
        joinRef.current = null;
        clearTimeout(reconnectRef.current);
        localStorage.removeItem(PLAYER_KEY);
        setPlayerId(null);
        setState(null);
        setRole(null);
        setHistory(EMPTY_HISTORY);
        setPendingPlayers([]);
        setStatus('closed');
        setError('Хост закрыл игровую сессию. Можно подключиться, когда начнётся новая игра.');
      } else if (message.type === 'error') {
        setError(message.message || 'Неизвестная ошибка сервера.');
      } else if (message.type === 'sound') {
        setLastEvent({ ...message, eventId: crypto.randomUUID() });
      }
    });

    socket.addEventListener('close', () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      if (!mountedRef.current || !joinRef.current) return;
      setStatus((current) => (current === 'rejected' || current === 'closed' ? current : 'disconnected'));
      reconnectRef.current = setTimeout(connect, 1500);
    });

    socket.addEventListener('error', () => {
      if (socketRef.current === socket) setError('Не удалось связаться с локальным сервером.');
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!isHost) {
      const savedPlayerId = localStorage.getItem(PLAYER_KEY);
      const savedName = localStorage.getItem(PLAYER_NAME);
      if (savedPlayerId && savedName) {
        joinRef.current = { name: savedName, playerId: savedPlayerId };
        connect();
      }
      return () => {
        mountedRef.current = false;
        clearTimeout(reconnectRef.current);
        socketRef.current?.close();
        socketRef.current = null;
      };
    }
    let cancelled = false;
    setStatus('connecting');
    fetch('/api/host/claim', { method: 'POST' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || body.error || 'Хост доступен только на компьютере, где запущен сервер.');
        if (cancelled) return;
        hostKeyRef.current = body.hostKey;
        localStorage.setItem(HOST_KEY, body.hostKey);
        joinRef.current = { hostKey: body.hostKey };
        connect();
      })
      .catch((reason) => {
        if (!cancelled) {
          setStatus('error');
          setError(reason.message);
        }
      });
    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearTimeout(reconnectRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [isHost, connect]);

  const join = useCallback((name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Введите имя игрока.');
      return;
    }
    setError('');
    joinRef.current = { name: trimmed, playerId: localStorage.getItem(PLAYER_KEY) };
    connect();
  }, [connect]);

  const startNewSession = useCallback(() => {
    if (!hostKeyRef.current) return;
    setError('');
    joinRef.current = { hostKey: hostKeyRef.current };
    socketRef.current?.close();
    socketRef.current = null;
    connect();
  }, [connect]);

  const send = useCallback((type, payload = {}) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setError('Соединение ещё не готово. Повторите действие через секунду.');
      return false;
    }
    socketRef.current.send(JSON.stringify({ type, ...payload }));
    return true;
  }, []);

  const request = useCallback(async (url, options = {}) => {
    const clientId = isHost ? hostKeyRef.current : playerId;
    if (!clientId) throw new Error('Сначала подключитесь к столу.');
    const response = await fetch(url, {
      ...options,
      headers: { 'x-client-id': clientId, ...options.headers },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.error || 'Не удалось выполнить запрос.');
    return result;
  }, [isHost, playerId]);

  const upload = useCallback(async (kind, file, name, dimensions = {}) => {
    const body = new FormData();
    body.append('file', file);
    body.append('name', name);
    if (dimensions.width) body.append('width', String(dimensions.width));
    if (dimensions.height) body.append('height', String(dimensions.height));
    const result = await request(`/api/upload?kind=${encodeURIComponent(kind)}`, { method: 'POST', body });
    return result.item;
  }, [request]);

  const getLibrary = useCallback(async () => {
    const result = await request('/api/library');
    return result.items;
  }, [request]);

  const importLibrary = useCallback(async (kind, file, dimensions = {}) => {
    const result = await request('/api/library/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, fileName: file.fileName, name: file.name, ...dimensions }),
    });
    return result.item;
  }, [request]);

  const leave = useCallback(() => {
    localStorage.removeItem(PLAYER_KEY);
    location.reload();
  }, []);

  return {
    state, pendingPlayers, history, role, playerId, status, error, lastEvent,
    join, startNewSession, send, upload, getLibrary, importLibrary, leave, clearError: () => setError(''),
  };
}
