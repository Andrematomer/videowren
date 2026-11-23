import { useEffect, useState } from 'preact/hooks';
import { engine } from './engine.ts';
import { getState, importFiles, toast } from './store.ts';

/** Voice recording straight onto the timeline: the timeline plays from the yellow line while the microphone records; stopping puts the take on an audio lane at that start time. */
let rec: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let startAt = 0;
let t0 = 0;
let startedPlay = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export const isRecording = (): boolean => rec !== null;
export const recordingSeconds = (): number => (rec ? (performance.now() - t0) / 1000 : 0);

export function useRecording(): boolean {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  return rec !== null;
}

const pickType = (): { mime: string; ext: string } => {
  for (const [mime, ext] of [['audio/mp4', 'm4a'], ['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm'], ['audio/ogg;codecs=opus', 'ogg']] as const) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: '', ext: 'm4a' };
};

export async function startRecording(): Promise<void> {
  if (rec) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return void toast('This browser cannot record sound.');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    return void toast('Microphone access was not given. Allow it in the browser settings to record.');
  }
  const { mime, ext } = pickType();
  chunks = [];
  startAt = Math.round(getState().playhead * 100) / 100;
  const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  r.onstop = () => {
    const type = r.mimeType || mime || 'audio/mp4';
    const blob = new Blob(chunks, { type });
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    rec = null;
    chunks = [];
    emit();
    if (blob.size < 200) return void toast('Nothing was recorded.');
    const n = getState().project.clips.filter((c) => c.mediaId && getState().project.media[c.mediaId]?.name.startsWith('Recording')).length + 1;
    void importFiles([new File([blob], `Recording ${n}.${ext}`, { type })], 'time', { at: startAt, track: -1 });
  };
  rec = r;
  t0 = performance.now();
  r.start(250);
  emit();
  // play along so the voice can follow the picture; with nothing to play the recording still runs
  startedPlay = getState().project.clips.length > 0;
  if (startedPlay) void engine.play();
}

export function stopRecording(): void {
  if (!rec) return;
  if (startedPlay) engine.pause();
  startedPlay = false;
  rec.state !== 'inactive' && rec.stop();
}
