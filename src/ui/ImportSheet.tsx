import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { dragCtl, endDrop } from '../dropAim.ts';
import { engine } from '../engine.ts';
import { isAudioFile, isImageFile } from '../media.ts';
import { addSolid, addTextClip, getState, importFiles, pasteClipboard, set, toast, useStore } from '../store.ts';
import { LevelBar } from './LevelBar.tsx';
import { armRecorder, cancelRecording, knownDuration, micLevel, pauseRecording, recordingSeconds, resumeRecording, startRecording, stopRecording, useRecorder } from '../recorder.ts';
import { ImageIcon, MicIcon, PaletteIcon, PasteIcon, TypeIcon } from './icons.tsx';
import { PickLabel } from './Picker.tsx';
import { Sheet } from './Sheet.tsx';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The Import tab. Five ways to get something in. Pictures, videos and sounds (from the files, the clipboard or the microphone) wait here
 * as a card with their thumbnails: the card is dragged onto the timeline or the preview, and lands exactly like files dragged in from outside,
 * except that here the number of items is known while the finger is still moving.
 */
export function ImportSheet({ onClose }: { onClose: () => void }) {
  const tray = useStore((s) => s.tray);
  const recording = useRecorder().armed;
  return (
    <Sheet title="Import" onClose={onClose}>
      {recording ? <Recorder /> : tray.length > 0 ? <Tray files={tray} /> : <Choices onDone={onClose} />}
    </Sheet>
  );
}

function Choices({ onDone }: { onDone: () => void }) {
  void onDone;
  const go = (f: () => void) => () => {
    engine.pause();
    f();
  };
  return (
    <div class="import-choices" role="menu">
      <PickLabel class="import-item" label="Pictures, videos and sound from this device" mode="tray">
        <ImageIcon size={22} />
        <span>Media</span>
      </PickLabel>
      <button class="import-item" role="menuitem" onClick={go(() => void addTextClip('time'))}>
        <TypeIcon size={22} />
        <span>Text</span>
      </button>
      <button class="import-item" role="menuitem" onClick={go(() => void addSolid('#2f6fed', 'time'))}>
        <PaletteIcon size={22} />
        <span>Color</span>
      </button>
      <button class="import-item" role="menuitem" onClick={go(armRecorder)}>
        <MicIcon size={22} />
        <span>Record audio</span>
      </button>
      <button class="import-item" role="menuitem" onClick={go(() => void pasteClipboard('time', true))}>
        <PasteIcon size={22} />
        <span>Clipboard</span>
      </button>
    </div>
  );
}

/** the voice as it comes in: a scrolling picture of its loudness, newest on the right */
function Scope({ on }: { on: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const hist = useRef<number[]>([]);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const c = cv.current;
      if (!c) return;
      if (on && now - last > 40) {
        last = now;
        const { rms } = micLevel();
        hist.current.push(Math.min(1, Math.max(0, (20 * Math.log10(Math.max(rms, 1e-5)) + 60) / 60)));
        if (hist.current.length > 200) hist.current.shift();
      }
      const w = c.width;
      const h = c.height;
      const x = c.getContext('2d')!;
      x.clearRect(0, 0, w, h);
      x.fillStyle = '#6db3ff';
      const bar = 4;
      const n = Math.floor(w / bar);
      const list = hist.current.slice(-n);
      list.forEach((v, i) => {
        const bh = Math.max(2, v * h);
        x.fillRect(w - (list.length - i) * bar, (h - bh) / 2, bar - 1, bh);
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
  return <canvas class="rec-scope" ref={cv} width={640} height={120} aria-hidden="true" />;
}

export function Recorder() {
  const { state } = useRecorder();
  const [, tick] = useState(0);
  useEffect(() => {
    const i = window.setInterval(() => tick((n) => n + 1), 200);
    return () => window.clearInterval(i);
  }, []);
  return (
    <div class="recorder">
      <div class={`rec-time num ${state}`}>
        <span class="rec-dot" />
        {fmt(recordingSeconds())}
      </div>
      <Scope on={state === 'recording'} />
      <LevelBar read={micLevel} label="Microphone level" class="rec-level" />
      <div class="rec-actions">
        {state === 'idle' ? (
          <>
            <button class="cta ghost" onClick={cancelRecording}>
              Cancel
            </button>
            <button class="cta" onClick={() => void startRecording()}>
              Record
            </button>
          </>
        ) : (
          <>
            <button class="cta ghost" onClick={state === 'paused' ? resumeRecording : pauseRecording}>
              {state === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button class="cta" onClick={stopRecording}>
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Thumb({ file, url }: { file: File; url: string }) {
  if (isAudioFile(file)) return <div class="tray-thumb sound"><MicIcon size={34} /></div>;
  if (isImageFile(file)) return <img class="tray-thumb" src={url} alt="" draggable={false} />;
  return <video class="tray-thumb" src={`${url}#t=0.1`} muted playsInline preload="metadata" />;
}

/** a little different turn and shift for every item, the same every time: a tidy pile like the one iOS shows while items are carried */
const PILE = [
  { r: 0, x: 0, y: 0 },
  { r: -7, x: -10, y: 4 },
  { r: 6, x: 11, y: -2 },
  { r: -13, x: -4, y: 9 },
  { r: 11, x: 6, y: 8 },
];

/** lengths in seconds of the items (what the outlines show while the card is carried) */
function useDurations(files: File[], urls: string[]): number[] {
  const [durs, setDurs] = useState<number[]>(() => files.map((f) => knownDuration.get(f) ?? (isImageFile(f) ? getState().prefs.imageSeconds : 3)));
  useEffect(() => {
    let live = true;
    files.forEach((f, i) => {
      if (isImageFile(f) || knownDuration.has(f)) return;
      const el = document.createElement(isAudioFile(f) ? 'audio' : 'video');
      el.preload = 'metadata';
      el.src = urls[i]!;
      el.onloadedmetadata = () => {
        if (live && Number.isFinite(el.duration) && el.duration > 0) setDurs((d) => d.map((v, k) => (k === i ? el.duration : v)));
        el.removeAttribute('src');
        el.load();
      };
    });
    return () => void (live = false);
  }, [files]);
  return durs;
}

function Tray({ files }: { files: File[] }) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const kinds = useMemo(() => files.map((f) => isAudioFile(f)), [files]);
  const durs = useDurations(files, urls);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const st = useRef<{ id: number; x: number; y: number; on: boolean } | null>(null);
  const shown = files.slice(0, 5);

  // the panel steps aside while the card is carried, so the whole timeline and the preview can be seen
  // (it comes back a moment after the drop, not at once: the drop closes the tab, and that must not be seen as a panel sliding out)
  useEffect(() => {
    const cl = document.documentElement.classList;
    if (drag) return void cl.add('tray-drag');
    const id = window.setTimeout(() => cl.remove('tray-drag'), 450);
    return () => clearTimeout(id);
  }, [!!drag]);
  useEffect(() => () => document.documentElement.classList.remove('tray-drag'), []);
  // while the card is carried, no other finger works on the app: every touch and pointer event of any other finger is swallowed before it reaches the timeline
  useEffect(() => {
    if (!drag) return;
    const block = (e: Event) => {
      const id = (e as PointerEvent).pointerId;
      if (id !== undefined && id === st.current?.id) return; // the carrying finger
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const opts = { capture: true, passive: false } as const;
    const names = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'gesturestart', 'gesturechange'];
    names.forEach((n) => window.addEventListener(n, block, opts));
    return () => names.forEach((n) => window.removeEventListener(n, block, opts));
  }, [!!drag]);

  const down = (e: PointerEvent) => {
    st.current = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = st.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.on && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) return;
    d.on = true;
    e.preventDefault();
    setDrag({ x: e.clientX, y: e.clientY });
    dragCtl.cur?.move(e.clientX, e.clientY, kinds, durs);
  };
  const up = (e: PointerEvent) => {
    const d = st.current;
    if (!d || d.id !== e.pointerId) return;
    st.current = null;
    setDrag(null);
    if (!d.on) return;
    const r = dragCtl.cur?.end();
    if (!r || e.type === 'pointercancel') return endDrop();
    if (r.lane && r.target) {
      set({ tray: [] });
      void importFiles(files, 'time', { track: r.target.track, at: r.target.at }).finally(endDrop);
    } else if (r.stage) {
      endDrop();
      set({ tray: [] });
      void importFiles(files, 'playhead');
    } else {
      endDrop();
      toast('Let go over the timeline or the preview.');
    }
  };
  return (
    <div class="tray">
      <div
        class={`tray-card ${drag ? 'dragging' : ''}`}
        role="group"
        aria-label={`${files.length} ${files.length === 1 ? 'item' : 'items'} ready to be dragged`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()}
      >
        {shown
          .map((f, i) => (
            <div key={i} class="tray-pile" style={{ transform: `translate(${PILE[i]!.x}px, ${PILE[i]!.y}px) rotate(${PILE[i]!.r}deg)`, zIndex: 10 - i }}>
              <Thumb file={f} url={urls[i]!} />
            </div>
          ))}
        <span class="tray-count num">{files.length}</span>
      </div>
      <p class="tray-hint">
        {files.length === 1 ? 'Ready.' : `${files.length} items ready.`} Drag the pile onto the timeline or the preview.
      </p>
      <button class="cta ghost" onClick={() => set({ tray: [] })}>
        Choose something else
      </button>
      {drag && (
        <div class="tray-flying" style={{ left: `${drag.x}px`, top: `${drag.y}px` }}>
          <Thumb file={files[0]!} url={urls[0]!} />
          {files.length > 1 && <span class="tray-count num">{files.length}</span>}
        </div>
      )}
    </div>
  );
}

/** The Replace tab of a picked strip: the same five ways in, but the first thing chosen takes the place of the strip (its look, effects, volume, position, crop and speed are kept where they still apply) */
export function ReplacePanel() {
  const rec = useRecorder().armed;
  if (rec) return <Recorder />;
  const go = (f: () => void) => () => {
    engine.pause();
    f();
  };
  return (
    <div class="import-choices" role="menu">
      <PickLabel class="import-item" label="Replace with a picture, video or sound from this device" mode="replace">
        <ImageIcon size={22} />
        <span>Media</span>
      </PickLabel>
      <button class="import-item" role="menuitem" onClick={go(() => void addTextClip('replace'))}>
        <TypeIcon size={22} />
        <span>Text</span>
      </button>
      <button class="import-item" role="menuitem" onClick={go(() => void addSolid('#2f6fed', 'replace'))}>
        <PaletteIcon size={22} />
        <span>Color</span>
      </button>
      <button class="import-item" role="menuitem" onClick={go(() => armRecorder(true))}>
        <MicIcon size={22} />
        <span>Record audio</span>
      </button>
      <button class="import-item" role="menuitem" onClick={go(() => void pasteClipboard('replace'))}>
        <PasteIcon size={22} />
        <span>Clipboard</span>
      </button>
    </div>
  );
}
