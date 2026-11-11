import React, { useEffect, useRef, useState } from 'react';

let youtubePromise;
function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubePromise) return youtubePromise;
  youtubePromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      youtubePromise = null;
      reject(new Error('Не удалось загрузить YouTube Player. Проверьте доступ к YouTube.'));
    };
    document.head.appendChild(script);
  });
  return youtubePromise;
}

export default function AudioManager({ music, sounds, send, lastEvent, enabled, localVolume = 1 }) {
  const currentTrack = music.tracks.find((track) => track.id === music.currentId) || null;
  const bootstrapTrack = currentTrack?.type === 'youtube' ? currentTrack : music.tracks.find((track) => track.type === 'youtube') || null;
  const playbackVolume = Math.min(1, music.volume * localVolume);
  const audioRef = useRef(new Audio());
  const youtubeRef = useRef(null);
  const youtubeContainerRef = useRef(null);
  const youtubeReadyRef = useRef(false);
  const musicRef = useRef(music);
  const sendRef = useRef(send);
  const enabledRef = useRef(enabled);
  const effectRef = useRef([]);
  const youtubeTrackRef = useRef(null);
  const youtubePlayingRef = useRef(false);
  const initialYoutubeSyncRef = useRef(currentTrack?.type === 'youtube' && music.playing);
  const previousEnabledRef = useRef(enabled);
  const [error, setError] = useState('');
  const [youtubeReady, setYoutubeReady] = useState(false);

  useEffect(() => { musicRef.current = music; }, [music]);
  useEffect(() => { sendRef.current = send; }, [send]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  useEffect(() => {
    const audio = audioRef.current;
    audio.preload = 'auto';
    const ended = () => {
      const current = musicRef.current;
      if (current.repeat === 'one') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        sendRef.current('music:control', { action: 'next' });
      }
    };
    audio.addEventListener('ended', ended);
    return () => { audio.removeEventListener('ended', ended); audio.pause(); };
  }, []);

  useEffect(() => {
    if (!bootstrapTrack) return;
    let cancelled = false;
    loadYouTube().then((YT) => {
      if (cancelled || youtubeRef.current || !youtubeContainerRef.current) return;
      youtubeTrackRef.current = bootstrapTrack.id;
      youtubeRef.current = new YT.Player(youtubeContainerRef.current, {
        width: 160,
        height: 90,
        videoId: bootstrapTrack.videoId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0, origin: location.origin, enablejsapi: 1, playsinline: 1, html5: 1 },
        events: {
          onReady: () => {
            youtubeRef.current?.setPlaybackQuality?.('small');
            youtubeReadyRef.current = true;
            setYoutubeReady(true);
          },
          onStateChange: (event) => {
            youtubePlayingRef.current = event.data === YT.PlayerState.PLAYING;
            if (youtubePlayingRef.current) youtubeRef.current?.setPlaybackQuality?.('small');
            if (event.data !== YT.PlayerState.ENDED) return;
            const current = musicRef.current;
            if (current.repeat === 'one') {
              youtubeRef.current.seekTo(0, true);
              youtubeRef.current.playVideo();
            } else {
              sendRef.current('music:control', { action: 'next' });
            }
          },
          onError: () => setError('YouTube не смог воспроизвести этот ролик.'),
        },
      });
    }).catch((reason) => setError(reason.message));
    return () => { cancelled = true; };
  }, [bootstrapTrack?.videoId]);

  useEffect(() => {
    const audio = audioRef.current;
    const isYoutube = currentTrack?.type === 'youtube';
    const resumingFromMute = enabled && !previousEnabledRef.current;
    const countElapsed = music.playing && (!isYoutube || youtubePlayingRef.current || initialYoutubeSyncRef.current);
    let desiredPosition = Math.max(0, music.position + (countElapsed ? (Date.now() - music.updatedAt) / 1000 : 0));
    if (!currentTrack || currentTrack.type !== 'audio') {
      audio.pause();
    } else {
      const source = new URL(currentTrack.url, location.origin).href;
      if (audio.src !== source) {
        audio.src = source;
        const seek = () => { audio.currentTime = Math.min(desiredPosition, Number.isFinite(audio.duration) ? audio.duration : desiredPosition); };
        audio.addEventListener('loadedmetadata', seek, { once: true });
      } else if (Math.abs(audio.currentTime - desiredPosition) > 2) {
        audio.currentTime = desiredPosition;
      }
      audio.loop = music.repeat === 'one';
      audio.volume = playbackVolume;
      if (music.playing && enabled) audio.play().catch(() => setError('Браузер заблокировал звук. Нажмите «Включить звук».'));
      else audio.pause();
    }

    const player = youtubeRef.current;
    if (!player || !youtubeReadyRef.current) return;
    player.setVolume(Math.round(playbackVolume * 100));
    const localPosition = player.getCurrentTime?.() || 0;
    if (resumingFromMute && localPosition > 0) desiredPosition = localPosition;
    if (!currentTrack || currentTrack.type !== 'youtube') {
      youtubePlayingRef.current = false;
      previousEnabledRef.current = enabled;
      player.pauseVideo();
      return;
    }
    if (currentTrack.id !== youtubeTrackRef.current) {
      youtubeTrackRef.current = currentTrack.id;
      youtubePlayingRef.current = false;
      initialYoutubeSyncRef.current = false;
      if (music.playing && enabled) player.loadVideoById({ videoId: currentTrack.videoId, startSeconds: desiredPosition });
      else player.cueVideoById({ videoId: currentTrack.videoId, startSeconds: desiredPosition });
    } else {
      if (Math.abs((player.getCurrentTime?.() || 0) - desiredPosition) > 2) player.seekTo(desiredPosition, true);
      if (music.playing && enabled) player.playVideo();
      else player.pauseVideo();
    }
    previousEnabledRef.current = enabled;
  }, [currentTrack?.id, currentTrack?.url, currentTrack?.videoId, music.playing, music.updatedAt, music.repeat, enabled, youtubeReady]);

  useEffect(() => {
    audioRef.current.volume = playbackVolume;
    youtubeRef.current?.setVolume?.(Math.round(playbackVolume * 100));
  }, [playbackVolume]);

  useEffect(() => {
    if (!enabled) {
      audioRef.current.pause();
      youtubeRef.current?.pauseVideo?.();
    }
  }, [enabled]);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.action === 'stop') {
      effectRef.current.forEach((audio) => { audio.pause(); audio.currentTime = 0; });
      effectRef.current = [];
      return;
    }
    if (!enabled || lastEvent.action !== 'play') return;
    const sound = sounds.find((item) => item.id === lastEvent.soundId);
    if (!sound) return;
    const audio = new Audio(sound.url);
    audio.volume = (lastEvent.volume ?? 0.8) * localVolume;
    effectRef.current.push(audio);
    audio.onended = () => { effectRef.current = effectRef.current.filter((item) => item !== audio); };
    audio.play().catch(() => setError('Не удалось воспроизвести звуковой эффект.'));
  }, [lastEvent, enabled, sounds, localVolume]);

  return <><div className="youtube-engine" aria-hidden="true"><div ref={youtubeContainerRef} /></div>{error && <button className="audio-error" onClick={() => setError('')}>{error}<span>×</span></button>}</>;
}
