import { useEffect, useState } from 'preact/hooks';
import { set, toast } from './store.ts';

/** Voice recording in the Import tab. Nothing plays meanwhile; the take is put into the tray, from where it is dragged onto the timeline. */
let rec: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let t0 = 0;
let taken = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

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

/** iPhone: while the microphone is in use the system treats the app like a phone call (quiet, earpiece). The audio session is put back to playing afterwards. */
type AudioSession = { type: string };
const session = (type: 'play-and-record' | 'playback'): void => {
  try {
    const s = (navigator as unknown as { audioSession?: AudioSession }).audioSession;
    if (s) s.type = type;
  } catch {
    /* not supported */
  }
};

const pickType = (): { mime: string; ext: string } => {
  for (const [mime, ext] of [['audio/mp4', 'm4a'], ['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm'], ['audio/ogg;codecs=opus', 'ogg']] as const) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: '', ext: 'm4a' };
};

const release = (): void => {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  session('playback');
};

export async function startRecording(): Promise<boolean> {
  if (rec) return true;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('This browser cannot record sound.'), false;
  session('play-and-record');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    session('playback');
    return toast('Microphone access was not given. Allow it in the browser settings to record.'), false;
  }
  const { mime, ext } = pickType();
  chunks = [];
  const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  r.onstop = () => {
    const type = r.mimeType || mime || 'audio/mp4';
    const blob = new Blob(chunks, { type });
    chunks = [];
    release();
    rec = null;
    emit();
    if (blob.size < 200) return void toast('Nothing was recorded.');
    set({ tray: [new File([blob], `Recording ${++taken}.${ext}`, { type })] });
  };
  rec = r;
  t0 = performance.now();
  r.start(250);
  emit();
  return true;
}

export function stopRecording(): void {
  if (rec && rec.state !== 'inactive') rec.stop();
}

/** leaves without keeping the take */
export function cancelRecording(): void {
  if (!rec) return;
  const r = rec;
  r.onstop = () => {
    chunks = [];
    release();
    rec = null;
    emit();
  };
  if (r.state !== 'inactive') r.stop();
}
