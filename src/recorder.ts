import { useEffect, useState } from 'preact/hooks';
import { engine } from './engine.ts';
import { getState, importFiles, set, toast } from './store.ts';

/**
 * Voice recording, two ways:
 *  - the Import / Replace tab: a panel with Record, Pause, Stop; the take goes to the tray (or replaces the picked strip)
 *  - the mic button of the middle bar ("take"): playing the timeline records, pausing pauses, moving the position ends it and puts the strip on the timeline
 */
let rec: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let t0 = 0;
let acc = 0;
let taken = 0;
/** the recorder panel is open (waiting for the person to start) */
let armed = false;
/** the take replaces the picked strip instead of waiting in the tray */
let replaceNext = false;
/** 'take': the mic button's recording on the timeline */
let kind: 'panel' | 'take' = 'panel';
let takeAt = 0;
/** the length of a take (a recorded file of some browsers does not say how long it is) */
export const knownDuration = new WeakMap<File, number>();
let lastSecs = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

// ---------- the level of the microphone ----------
let actx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
const buf = new Float32Array(1024);
/** the loudness of the microphone right now (0 to 1; 1 is clipping) */
export function micLevel(): { peak: number; rms: number } {
  if (!analyser) return { peak: 0, rms: 0 };
  analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
  let peak = 0;
  let sum = 0;
  for (const v of buf) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / buf.length) };
}
function listen(s: MediaStream): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    actx = new Ctx();
    analyser = actx.createAnalyser();
    analyser.fftSize = 1024;
    actx.createMediaStreamSource(s).connect(analyser);
    void actx.resume().catch(() => {});
  } catch {
    analyser = null;
  }
}

/** seconds recorded so far (a pause does not count) */
export const recordingSeconds = (): number => (rec ? acc + (rec.state === 'recording' ? (performance.now() - t0) / 1000 : 0) : 0);

export type RecState = { armed: boolean; state: 'idle' | 'recording' | 'paused' };
export function useRecorder(): RecState {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  return { armed: armed || rec !== null, state: rec ? (rec.state === 'paused' ? 'paused' : 'recording') : 'idle' };
}
export const armRecorder = (replace = false): void => ((armed = true), (replaceNext = replace), emit());
export const disarmRecorder = (): void => ((armed = false), (replaceNext = false), emit());

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
  analyser = null;
  void actx?.close().catch(() => {});
  actx = null;
  session('playback');
};

async function begin(): Promise<boolean> {
  if (rec) return true;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('This browser cannot record sound.'), false;
  session('play-and-record');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    session('playback');
    return toast('Microphone access was not given. Allow it in the browser settings to record.'), false;
  }
  listen(stream);
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
    armed = false;
    const was = kind;
    kind = 'panel';
    emit();
    if (was === 'take') set({ recording: null });
    if (blob.size < 200) return void toast('Nothing was recorded.');
    const f = new File([blob], `Recording ${++taken}.${ext}`, { type });
    knownDuration.set(f, lastSecs);
    if (was === 'take') void importFiles([f], 'time', { at: takeAt, track: -1 });
    else if (replaceNext) void importFiles([f], 'replace');
    else set({ tray: [f] });
    replaceNext = false;
  };
  rec = r;
  t0 = performance.now();
  acc = 0;
  r.start(250);
  emit();
  return true;
}

export const startRecording = (): Promise<boolean> => begin();

export function pauseRecording(): void {
  if (!rec || rec.state !== 'recording') return;
  acc += (performance.now() - t0) / 1000;
  rec.pause();
  emit();
}
export function resumeRecording(): void {
  if (!rec || rec.state !== 'paused') return;
  t0 = performance.now();
  rec.resume();
  emit();
}
export function stopRecording(): void {
  lastSecs = recordingSeconds();
  if (rec && rec.state !== 'inactive') rec.stop();
}

/** leaves without keeping the take */
export function cancelRecording(): void {
  if (!rec) return void disarmRecorder();
  const r = rec;
  r.onstop = () => {
    chunks = [];
    release();
    rec = null;
    armed = false;
    kind = 'panel';
    emit();
  };
  if (r.state !== 'inactive') r.stop();
}

// ---------- the mic button of the middle bar ----------

/** Play was pressed with the mic on: record (a new take, or go on with the paused one) and play the timeline along, silent */
export async function playTake(): Promise<void> {
  const g = getState();
  if (!rec) {
    kind = 'take';
    takeAt = Math.round(g.playhead * 100) / 100;
    if (!(await begin())) return void (kind = 'panel');
    set({ recording: { at: takeAt } });
  } else resumeRecording();
  starting = true;
  engine.silent = true;
  engine.openEnd = true;
  try {
    await engine.play();
  } finally {
    starting = false;
    expected = getState().playhead;
  }
}

/** Pause with the mic on: the take pauses with the timeline */
export function pauseTake(): void {
  if (kind === 'take') pauseRecording();
}

/** the take ends and its strip appears (a seek, or the mic button turned off) */
export function endTake(): void {
  if (kind !== 'take' || !rec) return;
  engine.pause();
  stopRecording();
  engine.silent = false;
  engine.openEnd = false;
}

// The take follows the timeline: it records while the timeline plays, pauses when it pauses, and ends when the position is moved by hand
let starting = false;
let expected = 0;
let wasPlaying = false;
window.setInterval(() => {
  if (kind !== 'take' || !rec || starting) return void (wasPlaying = false);
  const s = getState();
  if (s.playing) {
    wasPlaying = true;
    expected = s.playhead;
    if (rec.state === 'paused') resumeRecording();
    return;
  }
  if (rec.state === 'recording') pauseRecording();
  if (wasPlaying) {
    wasPlaying = false;
    expected = s.playhead; // where it stopped
    return;
  }
  if (Math.abs(s.playhead - expected) > 0.05) endTake();
}, 100);
