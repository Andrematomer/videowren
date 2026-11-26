import { blockOtherFingers } from './block.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { outputSize } from '../geometry.ts';
import { setQuarter } from '../turn.ts';
import { canPromptInstall, isAndroid, isIOS, isMobile, isStandalone, onInstallChange, promptInstall } from '../install.ts';
import { activeAt } from '../timeline.ts';
import { toast as say, deleteClip, deselect, duplicateClip, getState, importFiles, pasteFromEvent, redo, setMulti, removeGap, removeLane, restore, set, splitAtPlayhead, undo, useStore } from '../store.ts';
import { CanvasSheet } from './CanvasSheet.tsx';
import { HelpSheet } from './HelpSheet.tsx';
import { ImportSheet } from './ImportSheet.tsx';
import { ExportSheet } from './ExportSheet.tsx';
import { Camera, Copy, Gear, Help, Plus, Redo, Shrink, Trash, Undo } from './icons.tsx';
import { FilePicker, PickLabel } from './Picker.tsx';
import { Preview } from './Preview.tsx';
import { Drawer, TabBar } from './Drawer.tsx';
import { SettingsSheet } from './SettingsSheet.tsx';
import { saveFrame } from '../frame.ts';
import { aim, dragCtl, lift, liftX, showDropPreview, whereAt } from '../dropAim.ts';
import { isAudioFile, isImageFile } from '../media.ts';
import { Timeline } from './Timeline.tsx';
import { browserInfo, checkSupport } from '../support.ts';
import qrcode from 'qrcode-generator';

const support = checkSupport();

/** the height of the timeline the person last chose (a handle let go that did not open the full preview) */
const userTlH = (): number => {
  try {
    return Number(localStorage.getItem('pocket-cut-nla:tl-height')) || 200;
  } catch {
    return 200;
  }
};

/** the box where a paste is done by hand: touch and hold, then Paste. That hands over every copied file at once, which the paste button of a web page cannot always read */
function PasteCatcher() {
  const open = useStore((s) => s.pasteCatch);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) window.setTimeout(() => box.current?.focus(), 50);
  }, [open]);
  if (!open) return null;
  const close = () => set({ pasteCatch: false });
  return (
    <div class="paste-catch" onClick={close}>
      <div class="paste-card" role="dialog" aria-label="Paste" onClick={(e) => e.stopPropagation()}>
        <p>Touch and hold the box, then tap <b>Paste</b>.</p>
        <div
          ref={box}
          class="paste-box"
          contentEditable
          role="textbox"
          aria-label="Paste here"
          onInput={(e) => ((e.currentTarget as HTMLElement).innerHTML = '')}
          onPaste={(e) => {
            e.preventDefault();
            const dt = e.clipboardData;
            close();
            engine.pause();
            void pasteFromEvent(dt).then((ok) => ok || say('The clipboard has no picture, video, sound or text.'));
          }}
        >
          Paste here
        </div>
        <button class="cta ghost" onClick={close}>
          Cancel
        </button>
      </div>
    </div>
  );
}

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
  const [aimAt, setAimAt] = useState<{ x: number; y: number } | null>(null);
  const toast = useStore((s) => s.toast);
  const [hAnim, setHAnim] = useState(false);
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

  // iPhone: coming back from the app switcher can leave the page shifted up (the bottom tabs cut off). When the app is shown again the page is put back
  // and its size is worked out afresh.
  useEffect(() => {
    const fix = () => {
      window.scrollTo(0, 0);
      const a = document.querySelector('.app') as HTMLElement | null;
      if (!a) return;
      a.style.height = 'calc(100% + 0.5px)';
      requestAnimationFrame(() => (a.style.height = ''));
    };
    const back = () => {
      if (document.visibilityState === 'hidden') return;
      fix();
      window.setTimeout(fix, 250);
      window.setTimeout(fix, 900);
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('pageshow', back);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('pageshow', back);
      window.removeEventListener('focus', back);
    };
  }, []);

  // Files dragged in from outside (Files, Photos, another window) cover the whole page with a drop area: where exactly they would land is not
  // known while they are in the air (iPhone does not say how many there are before they are let go), so they are let go anywhere and then
  // wait in the Import tab, from where they are dragged to a place like anything else.
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    let idle = 0;
    const off = () => (clearTimeout(idle), setDropping(false));
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDropping(true);
      clearTimeout(idle);
      idle = window.setTimeout(off, 2500); // the system ended the drag without telling the page
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) off();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      off();
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /^(image|video|audio)\//.test(f.type) || isImageFile(f) || isAudioFile(f));
      if (files.length === 0) return;
      setEntered(true);
      set({ tray: files, sheet: 'import', drawer: null, selected: -1, multi: [], gap: null });
    };
    window.addEventListener('dragenter', over);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('dragend', off);
    window.addEventListener('touchstart', off, { passive: true });
    return () => {
      off();
      window.removeEventListener('dragenter', over);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', off);
      window.removeEventListener('touchstart', off);
    };
  }, []);

  // the drag of the card in the Import tab (pointer events): the outlines show where it would land, and a finger held at the edge scrolls the timeline
  useEffect(() => {
    let lit: Element | null = null;
    let stage: Element | null = null;
    let pos = { x: 0, y: 0 };
    let edge: { side: string; since: number } | null = null;
    let timer = 0;
    let kindsOf: boolean[] = [];
    let dursOf: number[] | undefined;
    const where = () => whereAt(pos.x, pos.y);
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
      const kinds = kindsOf.length ? kindsOf : [false];
      const at = { x: pos.x - liftX(), y: pos.y - lift(), fx: pos.x, kinds, durs: dursOf };
      showDropPreview(w.lane ? { ...at, mode: 'lane' } : w.stage ? { ...at, mode: 'stage' } : null);
      setAimAt(null);
      // held on the highest or lowest lane: a new lane opens now and then
      const lanes = [...document.querySelectorAll('.tl-lane')];
      // (only a finger really on the lane: empty space beside or under the lanes does not keep opening new ones)
      const lr = lit?.getBoundingClientRect();
      const inLane = !!lr && pos.y >= lr.top && pos.y <= lr.bottom;
      const side = inLane && lit === lanes[0] ? 'top' : inLane && lit === lanes[lanes.length - 1] ? 'bottom' : '';
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
      kindsOf = [];
      clear();
      showDropPreview(null);
      setAimAt(null);
      window.dispatchEvent(new CustomEvent('pc-lanes', { detail: 'reset' }));
    };
    dragCtl.cur = {
      move: (x, y, kinds, durs) => {
        pos = { x, y };
        kindsOf = kinds;
        dursOf = durs;
        update();
        if (!timer) timer = window.setInterval(update, 150);
      },
      end: () => {
        const w = where();
        dursOf = undefined;
        const target = aim.value ? { ...aim.value } : null;
        const p = { ...pos };
        const r = { lane: !!w.lane, stage: !!w.stage, target, pos: p };
        clearInterval(timer);
        timer = 0;
        edge = null;
        kindsOf = [];
        clear();
        setAimAt(null);
        return r;
      },
      cancel: stop,
    };
    return () => {
      stop();
      dragCtl.cur = null;
    };
  }, []);

  // the handle under the preview: drag to give the timeline or the preview more room
  useEffect(() => {
    // a number: the finger moves the handle (no easing); {h, anim}: the handle slides there by itself
    const f = (e: Event) => {
      const d = (e as CustomEvent<number | { h: number; anim: boolean }>).detail;
      setHAnim(typeof d !== 'number' && d.anim);
      setTlH(typeof d === 'number' ? d : d.h);
    };
    window.addEventListener('pc-tl-height', f);
    return () => window.removeEventListener('pc-tl-height', f);
  }, []);
  // recording: only the play and mic buttons work, so a new finger cannot upset the take
  const micOnNow = useStore((s) => s.micOn);
  useEffect(() => {
    if (!micOnNow) return;
    return blockOtherFingers((el) => !!el.closest('.tl-bar .play, .tl-bar .tl-btn.mode'));
  }, [micOnNow]);
  // a strip carried up over the preview: the same, only its own finger works
  const carryingNow = useStore((s) => s.carrying);
  useEffect(() => {
    if (carryingNow !== 'strip') return;
    return blockOtherFingers((el) => !!el.closest('.strip-clip'));
  }, [carryingNow]);
  // carrying a card from the Import tab: the timeline becomes twice as tall as the preview (the strips are bigger to aim at); let go: back to the person's own height
  const carrying = useStore((s) => s.carrying);
  const wasCarrying = useRef(false);
  useEffect(() => {
    if (carrying === 'tray') {
      wasCarrying.current = true;
      const app = document.querySelector('.app');
      const stage = document.querySelector('.stage') as HTMLElement | null;
      if (!app || !stage) return;
      const cs = getComputedStyle(stage);
      const cur = parseFloat(getComputedStyle(app).getPropertyValue('--tl-h')) || 200;
      const room = stage.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) + cur;
      window.dispatchEvent(new CustomEvent('pc-tl-height', { detail: { h: Math.round((room * 2) / 3), anim: true } }));
    } else if (wasCarrying.current) {
      wasCarrying.current = false;
      window.dispatchEvent(new CustomEvent('pc-tl-height', { detail: { h: userTlH(), anim: true } }));
    }
  }, [carrying]);

  // a tap on anything that is not a control (empty space around the canvas, the bars, the timeline background) selects nothing
  useEffect(() => {
    const tap = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el || !el.closest) return;
      // the tapped control may have been redrawn (a new icon) before this listener ran: it was a control, not empty space
      if (!el.isConnected) return;
      if (el.closest('button, a, input, label, textarea, select, .strip-clip, .frame, .tl-scroll, .tl-bar, .tl-gap, .drawer, .tabbar, .toast, .add-menu, .paste-catch')) return;
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
      else if (k === 'f') (e.preventDefault(), g.focus ? (window.dispatchEvent(new CustomEvent('pc-tl-height', { detail: { h: userTlH(), anim: true } })), set({ focus: false })) : set({ focus: true, drawer: null, sheet: 'none' }));
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
    <div class={`app ${hAnim ? 'h-anim' : ''} ${locked ? 'locked' : ''} ${slide ? 'slide' : ''} ${turn ? (turn > 0 ? 'turned-cw' : 'turned-ccw') : ''}`} style={{ '--tl-h': `${tlH}px` } as Record<string, string>}>
      <FilePicker />
      <PasteCatcher />
      {dropping && <div class="drop-veil"><span>Drop to import</span></div>}
      {aimAt && lift() > 0 && <AimLine from={aimAt} />}
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
          {shownSheet === 'import' && <ImportSheet onClose={() => set({ sheet: 'none' })} />}
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
  const [qr, setQr] = useState(false);
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
      {!isMobile && <p class="note-mobile">VideoWren is optimized for mobile devices. It works here, but it is made for a phone.</p>}
      <div class="welcome-buttons">
        {!isMobile && (
          <button class="cta" onClick={() => setQr(true)}>
            Download on mobile device
          </button>
        )}
        <button class="cta" onClick={install}>
          Install app{size}
        </button>
        <button class="cta ghost" onClick={onEnter}>
          Open in browser
        </button>
      </div>
      {steps && <InstallSteps onClose={() => setSteps(false)} />}
      {qr && <PhoneCode onClose={() => setQr(false)} />}
    </main>
  );
}

/** There is no link that installs a web app by itself: the install is always done in the phone's own browser. So the code opens the site, and the phone offers (or is told how) to install it from there. */
const SITE = 'https://videowren.web.app/';
/** the line from the finger to the bottom left corner of the first yellow outline; it follows the outline frame by frame (scrolling moves it) */
function AimLine({ from }: { from: { x: number; y: number } }) {
  const line = useRef<SVGLineElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const r = document.querySelector('.drop-ghost')?.getBoundingClientRect();
      if (r) last.current = { x: r.left, y: r.bottom };
      const l = line.current;
      const p = last.current;
      if (l && p) {
        l.setAttribute('x1', String(p.x));
        l.setAttribute('y1', String(p.y));
        l.style.visibility = 'visible';
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <svg class="aim-line" aria-hidden="true">
      <line ref={line} x1={from.x} y1={from.y} x2={from.x} y2={from.y} style={{ visibility: 'hidden' }} />
      <circle cx={from.x} cy={from.y} r="5.5" />
    </svg>
  );
}

function PhoneCode({ onClose }: { onClose: () => void }) {
  const q = qrcode(0, 'M');
  q.addData(SITE);
  q.make();
  return (
    <div class="install-steps phone-code" role="dialog" aria-modal="true" aria-label="Get VideoWren on a phone">
      <h2>Get VideoWren on your phone</h2>
      <div class="qr" role="img" aria-label={`QR code for ${SITE}`} dangerouslySetInnerHTML={{ __html: q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) }} />
      <p>Scan this with the camera of your phone. It opens {SITE.replace('https://', '').replace(/\/$/, '')}; there, tap Install app (Android), or Share, then Add to Home Screen (iPhone).</p>
      <button class="cta" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/** Full-screen instructions for installing on devices that cannot show the install prompt themselves. */
function InstallSteps({ onClose }: { onClose: () => void }) {
  const body = isIOS ? (
    <ol>
      <li>Open the Share menu of the browser (look for Share; in some versions it is inside a menu first).</li>
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
      <button class="tl-btn exit" onClick={() => (window.dispatchEvent(new CustomEvent('pc-tl-height', { detail: { h: userTlH(), anim: true } })), set({ focus: false }))} aria-label="Leave full preview">
        <Shrink />
      </button>
    </div>
  );
}
