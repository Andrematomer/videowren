import { useEffect, useRef, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { outputSize } from '../geometry.ts';
import { setQuarter } from '../turn.ts';
import { canPromptInstall, isAndroid, isIOS, isMobile, isStandalone, onInstallChange, promptInstall } from '../install.ts';
import { activeAt } from '../timeline.ts';
import { toast as say, deleteClip, deselect, duplicateClip, getState, importFiles, pasteFromEvent, redo, setMulti, removeGap, removeLane, restore, set, splitAtPlayhead, undo, useStore } from '../store.ts';
import { CanvasSheet } from './CanvasSheet.tsx';
import { HelpSheet } from './HelpSheet.tsx';
import { ExportSheet } from './ExportSheet.tsx';
import { Camera, Copy, Gear, Help, Plus, Redo, Shrink, Trash, Undo } from './icons.tsx';
import { FilePicker, PickLabel } from './Picker.tsx';
import { Preview } from './Preview.tsx';
import { Drawer, TabBar } from './Drawer.tsx';
import { SettingsSheet } from './SettingsSheet.tsx';
import { saveFrame } from '../frame.ts';
import { aim } from '../dropAim.ts';
import { isAudioFile } from '../media.ts';
import { Timeline } from './Timeline.tsx';
import { browserInfo, checkSupport } from '../support.ts';

const support = checkSupport();

export function App() {
  const ready = useStore((s) => s.ready);
  const hasClips = useStore((s) => s.project.clips.length > 0);
  // installed, or after "Open in browser": the editor opens straight away, even with nothing in it yet
  const [entered, setEntered] = useState(isStandalone);
  const [tryAnyway, setTryAnyway] = useState(false);
  const sheet = useStore((s) => s.sheet);
  const focus = useStore((s) => s.focus);
  const locked = useStore((s) => s.locked);
  const slide = useStore((s) => s.slide);
  // Full preview of a wide project on a portrait screen: the whole screen is turned a quarter, so the wide picture fills it
  // (the buttons turn with it). A screen that is already wide (a tab turned by the browser) needs nothing.
  const wide = useStore((s) => {
    const o = outputSize(s.project);
    return o.w > o.h;
  });
  const [portrait, setPortrait] = useState(() => window.innerHeight >= window.innerWidth);
  useEffect(() => {
    const f = () => setPortrait(window.innerHeight >= window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const turn: 0 | 90 | -90 = focus && wide && portrait ? 90 : 0;
  useEffect(() => setQuarter(turn), [turn]);
  // a closed sheet stays for a moment so it can slide out
  const [lastSheet, setLastSheet] = useState<typeof sheet>('none');
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (sheet !== 'none') {
      setLastSheet(sheet);
      setLeaving(false);
      return;
    }
    if (lastSheet === 'none') return;
    setLeaving(true);
    const id = window.setTimeout(() => (setLastSheet('none'), setLeaving(false)), 190);
    return () => clearTimeout(id);
  }, [sheet]);
  const shownSheet = sheet !== 'none' ? sheet : lastSheet;
  const busy = useStore((s) => s.busy);
  const toast = useStore((s) => s.toast);
  const [tlH, setTlH] = useState(() => {
    try {
      return Number(localStorage.getItem('pocket-cut-nla:tl-height')) || 200;
    } catch {
      return 200;
    }
  });

  useEffect(() => {
    void restore();
  }, []);

  // drag files onto the page: over a timeline lane that lane lights up and the files follow one another on it (held on the
  // top or bottom lane, more lanes open); over the preview area they go on the yellow line, each on its own layer
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    let lit: Element | null = null;
    let stage: Element | null = null;
    let pos = { x: 0, y: 0 };
    let edge: { side: string; since: number } | null = null;
    let timer = 0;
    let kindsOf: boolean[] = [];
    const where = () => {
      const els = document.elementsFromPoint(pos.x, pos.y);
      return { lane: els.find((x) => x.classList.contains('tl-lane')) ?? null, stage: els.find((x) => x.classList.contains('stage')) ?? null };
    };
    const clear = () => {
      lit?.classList.remove('target');
      stage?.classList.remove('drop-on');
      lit = null;
      stage = null;
    };
    const update = () => {
      const w = where();
      if (w.lane !== lit || w.stage !== stage) {
        clear();
        lit = w.lane;
        stage = w.lane ? null : w.stage;
        stage?.classList.add('drop-on');
      }
      // the yellow outlines in the timeline show where the files would land (nothing is lit up any more)
      const kinds = kindsOf.length ? kindsOf : [false];
      window.dispatchEvent(new CustomEvent('pc-drop-preview', { detail: w.lane ? { x: pos.x, y: pos.y, kinds, mode: 'lane' } : w.stage ? { x: pos.x, y: pos.y, kinds, mode: 'stage' } : null }));
      // held on the highest or lowest lane: a new lane opens now and then
      const lanes = [...document.querySelectorAll('.tl-lane')];
      const side = lit && lit === lanes[0] ? 'top' : lit && lit === lanes[lanes.length - 1] ? 'bottom' : '';
      if (!side) edge = null;
      else if (!edge || edge.side !== side) edge = { side, since: performance.now() };
      else if (performance.now() - edge.since > 420) {
        edge.since = performance.now();
        window.dispatchEvent(new CustomEvent('pc-lanes', { detail: side }));
        window.setTimeout(update, 60); // the lanes are drawn again: aim again
      }
    };
    const stop = () => {
      clearInterval(timer);
      timer = 0;
      edge = null;
      clear();
      window.dispatchEvent(new CustomEvent('pc-drop-preview', { detail: null }));
      window.dispatchEvent(new CustomEvent('pc-lanes', { detail: 'reset' }));
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      pos = { x: e.clientX, y: e.clientY };
      kindsOf = [...(e.dataTransfer?.items ?? [])].filter((it) => it.kind === 'file').map((it) => it.type.startsWith('audio/'));
      update();
      if (!timer) timer = window.setInterval(update, 150); // a drag that stands still sends no events
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) stop();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      pos = { x: e.clientX, y: e.clientY };
      const files = [...(e.dataTransfer?.files ?? [])];
      const w = where();
      const target = aim.value ? { ...aim.value } : null;
      // the outlines stay until the files are read and their strips appear
      const done = () => window.dispatchEvent(new CustomEvent('pc-drop-preview', { detail: null }));
      stop();
      if (w.lane && target) {
        window.dispatchEvent(new CustomEvent('pc-drop-preview', { detail: { x: pos.x, y: pos.y, kinds: files.map((f) => isAudioFile(f)), mode: 'lane' } }));
        void importFiles(files, 'time', { track: target.track, at: target.at }).finally(done);
      } else if (w.stage) void importFiles(files, 'playhead');
      else void importFiles(files);
    };
    window.addEventListener('dragenter', over);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('dragend', stop);
    return () => {
      stop();
      window.removeEventListener('dragenter', over);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', stop);
    };
  }, []);

  // the handle under the preview: drag to give the timeline or the preview more room
  useEffect(() => {
    const f = (e: Event) => setTlH((e as CustomEvent<number>).detail);
    window.addEventListener('pc-tl-height', f);
    return () => window.removeEventListener('pc-tl-height', f);
  }, []);

  // a tap on anything that is not a control (empty space around the canvas, the bars, the timeline background) selects nothing
  useEffect(() => {
    const tap = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el || !el.closest) return;
      // the tapped control may have been redrawn (a new icon) before this listener ran: it was a control, not empty space
      if (!el.isConnected) return;
      if (el.closest('button, a, input, label, textarea, select, .strip-clip, .frame, .tl-scroll, .tl-bar, .tl-gap, .drawer, .tabbar, .toast, .add-menu')) return;
      deselect();
    };
    // a picked gap is let go by the next touch anywhere (except on the gap itself, which holds the trash can)
    const letGo = (e: PointerEvent) => {
      if (!getState().gap) return;
      const el = e.target as Element | null;
      if (el?.closest?.('.tl-gap')) return;
      set({ gap: null });
    };
    // a tool that is open (a sheet or a drawer) is put away by a touch anywhere outside it, and that same touch
    // goes on to whatever is underneath: nothing sits in front of the app, so a swipe on the timeline still grabs it
    const putAway = (e: PointerEvent) => {
      const st = getState();
      if (st.sheet === 'none' && !st.drawer) return;
      const el = e.target as Element | null;
      if (el?.closest?.('.drawer, .tabbar, .toast, .lock-veil, header.top')) return;
      if (st.sheet !== 'none') {
        if (st.exporting) return; // an export that is running is never cancelled by a stray touch
        set({ sheet: 'none' });
      }
      if (st.drawer) set({ drawer: null });
    };
    window.addEventListener('click', tap);
    window.addEventListener('pointerdown', letGo, true);
    window.addEventListener('pointerdown', putAway, true);
    return () => {
      window.removeEventListener('click', tap);
      window.removeEventListener('pointerdown', letGo, true);
      window.removeEventListener('pointerdown', putAway, true);
    };
  }, []);

  useEffect(() => {
    if (!hasClips) engine.pause();
  }, [hasClips]);

  // keyboard, only the basics everyone already knows (a computer is a second-class citizen here)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // typing somewhere keeps its keys; a file picker that still has focus after choosing files does not count
      const typing = t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && !/^(file|button|submit|checkbox|radio|color|range)$/.test((t as HTMLInputElement).type)));
      if (typing) return;
      const g = getState();
      if (g.project.clips.length === 0 || g.sheet !== 'none') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') (e.preventDefault(), e.shiftKey ? redo() : undo());
      else if (mod && k === 'y') (e.preventDefault(), redo());
      else if (mod && k === 'a') {
        // Ctrl+A cycles: the strips under the yellow line, then every strip, then back to the ones under the line
        e.preventDefault();
        const cs = g.project.clips;
        const under = activeAt(cs, g.playhead).map((i) => cs[i]!.id);
        const all = cs.map((c) => c.id);
        const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
        const now = g.multi;
        engine.pause();
        const partial = under.length > 0 && under.length < all.length;
        if (partial && same(now, under)) setMulti(all);
        else if (under.length > 0) setMulti(under);
        else setMulti(all);
      }
      else if (mod && k === 'd') (e.preventDefault(), g.selected >= 0 && (engine.pause(), duplicateClip(g.selected)));
      else if (mod || e.altKey) return;
      else if (k === ' ') (e.preventDefault(), g.playing ? engine.pause() : void engine.play());
      else if (k === 's') splitAtPlayhead();
      else if (k === 'f') (e.preventDefault(), g.focus ? (window.dispatchEvent(new CustomEvent('pc-tl-height', { detail: 200 })), set({ focus: false })) : set({ focus: true, drawer: null, sheet: 'none' }));
      else if (k === 'delete' || k === 'backspace') {
        e.preventDefault();
        if (g.gap) g.gap.lane ? removeLane() : removeGap();
        else if (g.selected >= 0) (engine.pause(), deleteClip(g.selected));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // Ctrl+V / Cmd+V (also on a phone or tablet with a keyboard): the same as Add > On current time > Clipboard
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && !/^(file|button|submit|checkbox|radio|color|range)$/.test((t as HTMLInputElement).type)))) return;
      if (getState().sheet !== 'none') return;
      e.preventDefault();
      engine.pause();
      void pasteFromEvent(e.clipboardData).then((ok) => ok || say('The clipboard has no picture, video, sound or text.'));
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, []);

  return (
    <div class={`app ${locked ? 'locked' : ''} ${slide ? 'slide' : ''} ${turn ? (turn > 0 ? 'turned-cw' : 'turned-ccw') : ''}`} style={{ '--tl-h': `${tlH}px` } as Record<string, string>}>
      <FilePicker />
      {locked && <div class="lock-veil" />}

      {busy && !hasClips && <div class="busy">{busy}</div>}

      {!support.ok && !tryAnyway ? (
        <Unsupported onProceed={() => setTryAnyway(true)} />
      ) : !ready ? null : entered ? (
        focus ? (
          <main class="editor focus">
            <Preview />
            <FocusBar />
          </main>
        ) : (
          <main class="editor">
            <Preview />
            <Timeline />
            <TabBar />
            <Drawer />
          <div class={leaving ? 'sheet-out' : 'sheet-host'}>
          {shownSheet === 'export' && <ExportSheet onClose={() => set({ sheet: 'none' })} />}
          {shownSheet === 'help' && <HelpSheet onClose={() => set({ sheet: 'none' })} />}
          {shownSheet === 'canvas' && <CanvasSheet onClose={() => set({ sheet: 'none' })} />}
          {shownSheet === 'settings' && <SettingsSheet onClose={() => set({ sheet: 'none' })} />}

          </div>
          </main>
        )
      ) : (
        <Empty onEnter={() => setEntered(true)} />
      )}


      {toast && (
        <div class="toast" role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.run();
                set({ toast: null });
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Empty({ onEnter }: { onEnter: () => void }) {
  const [bytes, setBytes] = useState<number | null>(null);
  const [steps, setSteps] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => onInstallChange(() => tick((n) => n + 1)), []);
  useEffect(() => {
    fetch('./app-size.json')
      .then((r) => r.json())
      .then((j: { bytes?: number }) => typeof j.bytes === 'number' && setBytes(j.bytes))
      .catch(() => {});
  }, []);
  const size = bytes ? ` (${bytes >= 1e6 ? (bytes / 1e6).toFixed(1) : Math.max(1, Math.round(bytes / 1e3))} ${bytes >= 1e6 ? 'MB' : 'KB'})` : '';
  const install = () => {
    if (canPromptInstall()) void promptInstall();
    else setSteps(true);
  };
  return (
    <main class="empty">
      <img class="welcome-logo" src="./icons/icon.svg" alt="" width="132" height="132" />
      <h1>VideoWren</h1>
      <p class="slogan">A mobile video editor that fits in your pocket.</p>
      <p>Stack videos, pictures, text and sound on layers, then trim, crop, grade and time them on a real timeline. Small, offline and free. Everything happens on this device: no upload, no account, no watermark, and no trackers or analytics.</p>
      <div class="welcome-buttons">
        <button class="cta" onClick={install}>
          Install app{size}
        </button>
        <button class="cta ghost" onClick={onEnter}>
          Open in browser
        </button>
      </div>
      {steps && <InstallSteps onClose={() => setSteps(false)} />}
    </main>
  );
}

/** Full-screen instructions for installing on devices that cannot show the install prompt themselves. */
function InstallSteps({ onClose }: { onClose: () => void }) {
  const body = isIOS ? (
    <ol>
      <li>Tap the Share button (the square with an arrow).</li>
      <li>Scroll down and choose Add to Home Screen, then Add.</li>
      <li>If you don't see Add to Home Screen, this browser may not allow it. Open this page in Safari and try again.</li>
    </ol>
  ) : isAndroid ? (
    <ol>
      <li>Open the browser menu (the three dots).</li>
      <li>Tap Install app or Add to Home screen.</li>
      <li>Confirm. If you see neither, open this page in Chrome.</li>
    </ol>
  ) : isChromium ? (
    <ol>
      <li>Look at the right end of the address bar for the install icon and click it.</li>
      <li>Or open the browser menu and choose Install VideoWren.</li>
    </ol>
  ) : (
    <p>This browser may not be able to install apps. Open this page in Chrome, Edge or (on iPhone) Safari to install it, or use Open in browser.</p>
  );
  return (
    <div class="install-steps" role="dialog" aria-modal="true" aria-label="How to install">
      <h2>Install VideoWren</h2>
      {body}
      <button class="cta" onClick={onClose}>
        Got it
      </button>
    </div>
  );
}

function Unsupported({ onProceed }: { onProceed: () => void }) {
  const [more, setMore] = useState(false);
  return (
    <main class="fatal danger-page">
      <div class="danger-sign" aria-hidden="true">
        !
      </div>
      <h1>This browser can't run VideoWren</h1>
      <p>It needs video encoding (WebCodecs). On iPhone and iPad that means iOS 16.4 or newer with Safari. On Android, use a recent Chrome.</p>
      <ul class="checks">
        {support.rows.map((r) => (
          <li key={r.name} class={r.ok ? 'yes' : 'no'}>
            {r.ok ? '✓' : '✗'} {r.name}
          </li>
        ))}
      </ul>
      <div>
        <button class="link-text" aria-expanded={more} onClick={() => setMore(!more)}>
          Advanced
        </button>
      </div>
      {more && (
        <div class="danger-more">
          <p>VideoWren cannot protect your work in this browser. It may crash, lose your project, or export broken files.</p>
          <pre>{browserInfo()}</pre>
          <div>
            <a class="link-text" href="#" onClick={(e) => (e.preventDefault(), onProceed())}>
              Proceed to VideoWren (unsafe)
            </a>
          </div>
        </div>
      )}
    </main>
  );
}

const isChromium = /Chrome\/|Edg\//.test(navigator.userAgent) && !isMobile;

/** Preview focus: the picture fills the screen and only a few buttons stay (below it, or beside it when the phone is on its side). */
function FocusBar() {
  const selected = useStore((s) => s.selected);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const has = useStore((s) => !!s.project.clips[s.selected]);
  return (
    <div class="focus-bar">
      <button class="tl-btn" disabled={!has} onClick={() => (engine.pause(), deleteClip(selected))} aria-label="Delete the selected clip">
        <Trash />
      </button>
      <button class="tl-btn" disabled={!canUndo} onClick={undo} aria-label="Undo">
        <Undo />
      </button>
      <button class="tl-btn" disabled={!canRedo} onClick={redo} aria-label="Redo">
        <Redo />
      </button>
      <button class="tl-btn" disabled={!has} onClick={() => (engine.pause(), duplicateClip(selected))} aria-label="Duplicate the selected clip">
        <Copy />
      </button>
      <button class="tl-btn" onClick={() => (engine.pause(), void saveFrame())} aria-label="Save this frame as a picture">
        <Camera />
      </button>
      <button class="tl-btn exit" onClick={() => (window.dispatchEvent(new CustomEvent('pc-tl-height', { detail: 200 })), set({ focus: false }))} aria-label="Leave full preview">
        <Shrink />
      </button>
    </div>
  );
}
