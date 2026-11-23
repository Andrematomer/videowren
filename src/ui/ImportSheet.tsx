import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { dragCtl, lift, showDropPreview } from '../dropAim.ts';
import { engine } from '../engine.ts';
import { isAudioFile, isImageFile } from '../media.ts';
import { addSolid, addTextClip, importFiles, pasteClipboard, set, toast, useStore } from '../store.ts';
import { cancelRecording, recordingSeconds, startRecording, stopRecording, useRecording } from '../recorder.ts';
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
  const recording = useRecording();
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
      <button class="import-item" role="menuitem" onClick={go(() => void startRecording())}>
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

function Recorder() {
  const [, tick] = useState(0);
  useEffect(() => {
    const i = window.setInterval(() => tick((n) => n + 1), 200);
    return () => window.clearInterval(i);
  }, []);
  return (
    <div class="recorder">
      <div class="rec-time num">
        <span class="rec-dot" />
        {fmt(recordingSeconds())}
      </div>
      <p>Recording. Nothing plays meanwhile, so only your voice is recorded.</p>
      <div class="rec-actions">
        <button class="cta ghost" onClick={cancelRecording}>
          Cancel
        </button>
        <button class="cta" onClick={stopRecording}>
          Stop
        </button>
      </div>
    </div>
  );
}

function Thumb({ file, url }: { file: File; url: string }) {
  if (isAudioFile(file)) return <div class="tray-thumb sound"><MicIcon size={26} /></div>;
  if (isImageFile(file)) return <img class="tray-thumb" src={url} alt="" draggable={false} />;
  return <video class="tray-thumb" src={`${url}#t=0.1`} muted playsInline preload="metadata" />;
}

function Tray({ files }: { files: File[] }) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const kinds = useMemo(() => files.map((f) => isAudioFile(f)), [files]);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  // the panel steps aside while the card is carried, so the whole timeline and the preview can be seen
  useEffect(() => {
    document.documentElement.classList.toggle('tray-drag', !!drag);
    return () => document.documentElement.classList.remove('tray-drag');
  }, [!!drag]);
  const st = useRef<{ id: number; x: number; y: number; on: boolean } | null>(null);
  const shown = files.slice(0, 4);

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
    dragCtl.cur?.move(e.clientX, e.clientY, kinds);
  };
  const up = (e: PointerEvent) => {
    const d = st.current;
    if (!d || d.id !== e.pointerId) return;
    st.current = null;
    setDrag(null);
    if (!d.on) return;
    const r = dragCtl.cur?.end();
    if (!r) return showDropPreview(null);
    if (e.type === 'pointercancel') return showDropPreview(null);
    if (r.lane && r.target) {
      showDropPreview({ x: r.pos.x, y: r.pos.y - lift(), kinds, mode: 'lane' });
      set({ tray: [] });
      void importFiles(files, 'time', { track: r.target.track, at: r.target.at }).finally(() => showDropPreview(null));
    } else if (r.stage) {
      showDropPreview(null);
      set({ tray: [] });
      void importFiles(files, 'playhead');
    } else {
      showDropPreview(null);
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
        <div class={`tray-grid n${shown.length}`}>
          {shown.map((f, i) => (
            <Thumb key={i} file={f} url={urls[i]!} />
          ))}
        </div>
        <span class="tray-count num">{files.length}</span>
      </div>
      <p class="tray-hint">
        {files.length === 1 ? 'Ready.' : `${files.length} items ready.`} Drag the card onto the timeline or the preview.
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
