import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { keyOf } from '../bake.ts';
import { engine } from '../engine.ts';
import { thumbUrl } from '../media.ts';
import { hold, release as releaseHud, say } from '../hud.ts';
import { DOUBLE_MS, armTapWait, endTapWait, optimizeWithFeedback, pasteClipboard, deleteClip, deselect, duplicateClip, getState, moveClipTo, moveMulti, redo, removeGap, removeLane, selectClip, set, setMulti, splitAtPlayhead, toast, toggleMulti, undo, updateClip, useStore } from '../store.ts';
import { PEAKS_PER_SEC } from '../wave.ts';
import { MIN_CLIP, activeAt, optimizeLanes, clipDuration, clipEnd, fmtTime, gapAt, laneRemovable, stackTracks, totalOf } from '../timeline.ts';
import type { Clip, MediaInfo } from '../types.ts';
import { aim } from '../dropAim.ts';
import { Pie } from './Pie.tsx';
import { Copy, GapH, Pause, PasteIcon, Play, Redo, Simplify, Trash, Undo } from './icons.tsx';
import { haptic, hapticDouble, snapTicker } from '../haptic.ts';
import { outputSize } from '../geometry.ts';

const HOLD_MS = 350; // hold a strip this long (without moving) to pick it up
const WOBBLE = 10;
const EDGE = 44; // px from the edge of the timeline where dragging starts to scroll it
const ROW0 = 38;
const GAP = 4;
const RULER = 22;
const SNAP_PX = 8;
const MIN_PPS = 0.5; // about ten minutes across a phone screen
const MAX_PPS = 300;

interface Move {
  index: number;
  at: number;
  track: number;
  /** top of the strip in timeline pixels: follows the finger smoothly, the lane is only chosen on release */
  top: number;
  /** the edge of another strip (or the yellow line) it is lined up with, shown as a guide */
  guide: number | null;
}
interface Trim {
  index: number;
  at: number;
  start: number;
  end: number;
}

const isAudio = (m: MediaInfo | undefined) => m?.kind === 'audio';

/**
 * The lanes shown, top to bottom. Picture and video lanes count up from lane 0, sound lanes down from
 * -1. One empty lane is open beyond the last used one on each side, so a clip cannot get lost far away.
 */
export function lanesFor(clips: Clip[], extra = { hi: 0, lo: 0 }): number[] {
  // only the lanes between the first and the last strip, plus one free lane on each side (more while a strip is being held out there)
  let hi = clips.length ? -Infinity : 0;
  let lo = clips.length ? Infinity : 0;
  for (const c of clips) {
    hi = Math.max(hi, c.track);
    lo = Math.min(lo, c.track);
  }
  const out: number[] = [];
  for (let t = hi + 1 + extra.hi; t >= lo - 1 - extra.lo; t--) out.push(t);
  return out;
}

/**
 * The timeline. The yellow line is fixed; the timeline scrolls under it, and the position is wherever
 * the line is. Lanes higher up are drawn on top of the ones below; sound lives on the lanes under lane
 * 1. Tap a strip to select it (tap it again for its options). Hold a strip until it lifts, then drag it
 * in time or between lanes. A selected strip has handles on both ends: drag them to trim. Pinch to zoom.
 */
/** only strips that have a running time (video, sound) can slide their content: pictures, text and colors have none */
const slippable = (m: { kind?: string; text?: unknown; solid?: unknown } | undefined): boolean => !!m && m.kind !== 'image' && m.text === undefined && m.solid === undefined;

export function Timeline() {
  const clips = useStore((s) => s.project.clips);
  const media = useStore((s) => s.project.media);
  const selected = useStore((s) => s.selected);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const progress = useStore((s) => s.proxyProgress);
  const gap = useStore((s) => s.gap);
  const handles = useStore((s) => s.handles);
  const fps = useStore((s) => s.project.settings.fps);
  const [showFrames, setShowFrames] = useState(() => {
    try {
      return localStorage.getItem('wren:frames') === '1';
    } catch {
      return false;
    }
  });
  const multi = useStore((s) => s.multi);
  const waves = useStore((s) => s.waves);
  const bakes = useStore((s) => s.bakeProgress);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const hasSel = selected >= 0 && !!clips[selected];
  // cheap (a pass over the strips), so it is worked out whenever they change: Simplify is greyed out when there is nothing left to tighten
  const tight = useMemo(() => optimizeLanes(clips).moved === 0, [clips]);
  const [pps, setPps] = useState(36); // pixels per second
  const [move, setMove] = useState<Move | null>(null);
  const [trim, setTrim] = useState<Trim | null>(null);
  // edit mode: dragging the picked strip sideways slides the picture inside it (the strip keeps its place and length)
  const slipRef = useRef<{ id: number; i: number; x0: number; y0: number; base: { start: number; end: number }; active: boolean; cur: { start: number; end: number } } | null>(null);
  const [slip, setSlip] = useState<number | null>(null);
  const [viewW, setViewW] = useState(360);
  const scroller = useRef<HTMLDivElement>(null);
  const st = useRef<{ id: number; i: number; x0: number; y0: number; x: number; y: number; at0: number; track0: number; scroll0: number; scrollTop0: number; timer: number; active: boolean; raf: number; grab?: number; edge?: 'top' | 'bottom' | null; edgeAt?: number } | null>(null);
  const swallow = useRef(false);

  const prefRow = useStore((s) => s.prefs.rowScale);
  const rowAuto = useStore((s) => s.prefs.rowAuto);
  const [viewH, setViewH] = useState(200);
  const [ext, setExt] = useState({ hi: 0, lo: 0 });
  // files dragged in from outside open lanes the same way a held strip does (App.tsx sends these)
  useEffect(() => {
    const more = (e: Event) => {
      const side = (e as CustomEvent<string>).detail;
      if (side === 'reset') return setExt({ hi: 0, lo: 0 });
      setExt((x) => (side === 'top' ? { ...x, hi: x.hi + 1 } : { ...x, lo: x.lo + 1 }));
      if (side === 'bottom') requestAnimationFrame(() => requestAnimationFrame(() => scroller.current && (scroller.current.scrollTop = scroller.current.scrollHeight)));
    };
    window.addEventListener('pc-lanes', more);
    return () => window.removeEventListener('pc-lanes', more);
  }, []);
  // files dragged in from outside: where they would land is drawn as yellow outlines (App.tsx sends the finger position)
  const [ghosts, setGhosts] = useState<{ track: number; at: number; dur: number }[]>([]);
  useEffect(() => {
    const D = 3; // the length of an outline: the real length is only known after the files are read
    let was = '';
    const prev = (e: Event) => {
      const d = (e as CustomEvent<{ x: number; y: number; kinds: boolean[]; mode: 'lane' | 'stage' } | null>).detail;
      const el = scroller.current;
      const L = live.current;
      if (!d || !el) {
        aim.value = null;
        setGhosts([]);
        if (was === 'stage') setExt({ hi: 0, lo: 0 }); // the fingers left the preview: the lanes that were opened for it close again
        was = '';
        return;
      }
      if (was === 'stage' && d.mode === 'lane') setExt({ hi: 0, lo: 0 });
      was = d.mode;
      const pseudo = (track: number, at: number): Clip => ({ id: '', mediaId: '', start: 0, end: D, speed: 1, view: { x: 0, y: 0, zoom: 1, rot: 0 }, volume: 1, keepPitch: true, at, track });
      if (d.mode === 'stage') {
        // over the preview: every file starts at the yellow line on its own layer (open lanes are added as needed)
        aim.value = null;
        const placed: Clip[] = [];
        for (const base of [0, -1]) {
          const idx = d.kinds.map((a, i) => (a === (base === -1) ? i : -1)).filter((i) => i >= 0);
          const tr = stackTracks(L.clips, idx.map(() => ({ at: L.playhead, dur: D })), base);
          idx.forEach((_, k) => placed.push(pseudo(tr[k]!, L.playhead)));
        }
        const top = Math.max(...placed.map((c) => c.track), lanesFor(L.clips)[0]!);
        const bottom = Math.min(...placed.map((c) => c.track), lanesFor(L.clips).at(-1)!);
        const baseTop = lanesFor(L.clips)[0]!;
        const baseBottom = lanesFor(L.clips).at(-1)!;
        setExt((x) => {
          const n = { hi: Math.max(0, top - baseTop), lo: Math.max(0, baseBottom - bottom) };
          return n.hi === x.hi && n.lo === x.lo ? x : n;
        });
        setGhosts(placed.map((c) => ({ track: c.track, at: c.at, dur: D })));
        return;
      }
      // over a lane: the first file starts under the finger (snapping to strip edges and the yellow line), the rest follow it
      const r = el.getBoundingClientRect();
      const row = Math.floor((d.y - r.top + el.scrollTop - RULER) / (L.ROW + GAP));
      const track = L.lanes[row];
      if (track === undefined) {
        aim.value = null;
        setGhosts([]);
        return;
      }
      let at = Math.max(0, (d.x - r.left + el.scrollLeft - L.padL) / L.pps);
      const near = 12 / L.pps;
      let best = near;
      for (const t of [0, L.playhead, ...L.clips.flatMap((c) => [c.at, clipEnd(c)])]) {
        if (Math.abs(t - at) < best) (best = Math.abs(t - at)), (at = t);
      }
      at = Math.round(at * 100) / 100;
      aim.value = { track, at };
      const group = d.kinds.map((_, i) => pseudo(track, at + i * D));
      const dir = track >= 0 ? 1 : -1;
      const clash = (t: number) => group.some((g) => L.clips.some((o) => o.track === t && g.at < clipEnd(o) - 1e-6 && o.at < g.at + D - 1e-6));
      let t = track;
      for (let i = 0; i < 200 && clash(t); i++) t += dir;
      setGhosts(group.map((g) => ({ track: t, at: g.at, dur: D })));
    };
    window.addEventListener('pc-drop-preview', prev);
    return () => window.removeEventListener('pc-drop-preview', prev);
  }, []);
  const lanes = lanesFor(clips, ext);
  // auto: every lane that is shown fits the height of the timeline (between half and double the normal height)
  const autoScale = Math.min(2, Math.max(0.5, ((viewH - RULER - 6) / lanes.length - GAP) / ROW0));
  const rowScale = rowAuto ? autoScale : prefRow;
  const ROW = Math.round(ROW0 * rowScale);
  const total = totalOf(clips);
  const padL = Math.round(viewW / 4); // the yellow line sits a quarter of the way in
  const extent = Math.max(total, move ? move.at + (clips[move.index] ? clipDuration(clips[move.index]!) : 0) : 0);
  const width = extent * pps + viewW;
  const height = RULER + lanes.length * (ROW + GAP) + 6;
  const live = useRef({ clips, pps, lanes, playhead, media, padL, height, width, ROW });
  live.current = { clips, pps, lanes, playhead, media, padL, height, width, ROW };
  const rowTop = (row: number) => RULER + row * (ROW + GAP);
  /** where a pie sits on a strip: the middle of the part of the strip that is on screen (like the bin of a gap) */
  const pieX = (left: number, w: number): number => {
    const v0 = playhead * pps;
    const lo = Math.max(left, v0);
    const hi = Math.min(left + w, v0 + viewW);
    return w <= 40 || hi <= lo ? w / 2 : Math.max(14, Math.min(w - 14, (lo + hi) / 2 - left));
  };

  // the size of the viewport decides where the yellow line sits
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => (setViewW(el.clientWidth || 360), setViewH(el.clientHeight || 200)));
    ro.observe(el);
    setViewW(el.clientWidth || 360);
    setViewH(el.clientHeight || 200);
    return () => ro.disconnect();
  }, []);

  // the position moved by itself (playing, selecting a clip, zooming): scroll the timeline under the line
  // (not while the person is scrolling by hand: a snapped line is shown without moving the content under their finger)
  const lastUser = useRef(0);
  const settle = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (snapRef.current != null && Math.abs(playhead - snapRef.current) > 1e-6) (snapRef.current = null), setSnapAt(null); // moved by something else
    if (performance.now() - lastUser.current < 220) return;
    const want = playhead * pps;
    if (Math.abs(el.scrollLeft - want) > 1.5) el.scrollLeft = want;
  }, [playhead, pps, viewW, total]);

  /** tapping a strip: the position slides to its start while the zoom changes so the strip fills the middle half (25% to 75%) of the width */
  const glide = useRef(0);
  const tapped = useRef<string | null>(null);
  const tapTimer = useRef(0);
  const tapWait = useStore((s) => s.tapWait);
  const glideTo = (index: number, zoom: boolean) => {
    const c = live.current.clips[index];
    if (!c) return;
    const t1 = c.at;
    const p0 = live.current.pps;
    const p1 = zoom ? Math.max(MIN_PPS, Math.min(MAX_PPS, (0.5 * viewW) / Math.max(0.05, clipDuration(c)))) : p0;
    const t0 = getState().playhead;
    const T = 300;
    const start = performance.now();
    cancelAnimationFrame(glide.current);
    engine.holding = true;
    const tick = () => {
      const k = Math.min(1, (performance.now() - start) / T);
      const e = 1 - Math.pow(1 - k, 3);
      lastUser.current = 0;
      setPps(p0 * Math.pow(p1 / p0, e)); // zoom in steps that feel even
      const t = t0 + (t1 - t0) * e;
      set({ playhead: t });
      void engine.showAt(t);
      if (k < 1) glide.current = requestAnimationFrame(tick);
      else {
        engine.holding = false;
        void engine.showAt(t1);
      }
    };
    glide.current = requestAnimationFrame(tick);
  };

  // the person scrolled: the position follows (one preview refresh per frame at most)
  const seekFrame = useRef(0);
  const pinching = useRef(false);
  const [scrollTop, setScrollTop] = useState(0);
  const snapRef = useRef<number | null>(null);
  const moveTick = useRef(snapTicker());
  const trimTick = useRef(snapTicker());
  const [snapAt, setSnapAt] = useState<number | null>(null);
  const touching = useRef(false);
  /** after the hand has let go for a moment, the content slides to where the line is (never while a finger is still down) */
  const armSettle = () => {
    clearTimeout(settle.current);
    if (touching.current) return;
    settle.current = window.setTimeout(() => {
      lastUser.current = 0;
      const e2 = scroller.current;
      if (e2 && !pinching.current && !touching.current) {
        const want = getState().playhead * live.current.pps;
        if (Math.abs(e2.scrollLeft - want) > 1.5) e2.scrollLeft = want;
      }
    }, 160);
  };
  const onScroll = () => {
    const el = scroller.current;
    if (!el || pinching.current) return;
    setScrollTop(el.scrollTop);
    const t = Math.max(0, Math.min(totalOf(live.current.clips), el.scrollLeft / live.current.pps));
    if (Math.abs(t - live.current.playhead) * live.current.pps < 1.5) return;
    if (getState().playing) engine.pause();
    // the line is pulled to the start and end of every strip, like a strip being moved. Once caught it holds until the
    // finger is well past the edge (12 px), so jitter at the border of the magnet cannot flick it in and out
    let at = t;
    const px = live.current.pps;
    const held = snapRef.current;
    if (held != null && Math.abs(held - t) * px < 12) at = held;
    else {
      let best = 7 / px;
      let hit: number | null = null;
      for (const c of live.current.clips) {
        for (const e of [c.at, c.at + clipDuration(c)]) if (Math.abs(e - t) < best) (best = Math.abs(e - t)), (hit = e);
      }
      if (hit != null) {
        at = hit;
        try {
          haptic(6);
        } catch {
          /* not supported */
        }
      }
      snapRef.current = hit;
      setSnapAt(hit);
    }
    // moving around the timeline by hand leaves nothing selected (a strip being dragged or trimmed stays)
    const g = getState();
    if ((g.selected >= 0 || g.gap) && g.multi.length === 0 && !st.current?.active && !trimRef.current && !boxRef.current?.active) deselect();
    set({ playhead: at });
    // the content keeps following the finger, the line holds on the strip edge; when the hand lets go, the content slides to the line
    lastUser.current = performance.now();
    armSettle();
    if (!seekFrame.current)
      seekFrame.current = requestAnimationFrame(() => {
        seekFrame.current = 0;
        void engine.showAt(getState().playhead);
      });
  };

  // touch: pinch to zoom, and no scrolling while a strip is picked up
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let pinch: { d0: number; pps0: number } | null = null;
    // one finger: whichever direction wins in the first few pixels owns the whole drag (sideways seeks, up/down zooms)
    let lock: { x: number; y: number; pps0: number; axis: 'x' | 'y' | null } | null = null;
    let trail: { t: number; x: number; left: number }[] = [];
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY);
    const start = (e: TouchEvent) => {
      touching.current = true;
      engine.holding = true; // no full-size frame while a finger holds the position
      cancelAnimationFrame(glide.current);
      clearTimeout(settle.current);
      trail = [];
      lock = e.touches.length === 1 && !(e.target as Element).closest('.trim-h') ? { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, pps0: live.current.pps, axis: null } : null;
      if (e.touches.length === 2) {
        lock = null;
        pinch = { d0: dist(e), pps0: live.current.pps };
        pinching.current = true;
        if (st.current) {
          clearTimeout(st.current.timer);
          st.current = null;
        }
      }
    };
    const mv = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        setPps(Math.max(MIN_PPS, Math.min(MAX_PPS, (pinch.pps0 * dist(e)) / pinch.d0)));
      } else if (st.current?.active || slipRef.current?.active || trimRef.current || boxRef.current?.active) e.preventDefault();
      else if (lock && e.touches.length === 1 && (lock.axis === 'y' || (lock.axis === null && Math.hypot(e.touches[0]!.clientX - lock.x, e.touches[0]!.clientY - lock.y) > 10))) {
        const dx = e.touches[0]!.clientX - lock.x;
        const dy = e.touches[0]!.clientY - lock.y;
        if (lock.axis === null) lock.axis = Math.abs(dy) > Math.abs(dx) * 1.2 && el.scrollHeight <= el.clientHeight + 2 ? 'y' : 'x';
        if (lock.axis === 'y') {
          trail = []; // the sideways trail from before the zoom is about another zoom level
          e.preventDefault();
          // a strip that was only touched (not picked up, not slid) lets go: this drag is a zoom
          if (st.current && !st.current.active) (clearTimeout(st.current.timer), (st.current = null));
          if (slipRef.current && !slipRef.current.active) slipRef.current = null;
          const wasZooming = pinching.current;
          pinching.current = true; // the scroll that follows a zoom is not a seek
          el.style.overflowX = 'hidden'; // sideways is off for the rest of this drag
          // switching the overflow can throw the scroll position back to 0 (WebKit): put it where the line is, right away
          if (!wasZooming) el.scrollLeft = getState().playhead * live.current.pps;
          setPps(Math.max(MIN_PPS, Math.min(MAX_PPS, lock.pps0 * Math.exp(-dy / 140))));
        }
      } else if (e.touches.length === 1) {
        const now = performance.now();
        trail.push({ t: now, x: e.touches[0]!.clientX, left: el.scrollLeft });
        trail = trail.filter((p) => now - p.t < 120);
      }
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        touching.current = false;
        armSettle();
        engine.letGo();
      }
      if (lock?.axis === 'y') trail = [];
      if (lock?.axis === 'y' && e.touches.length === 0)
        requestAnimationFrame(() => {
          el.style.overflowX = '';
          el.scrollLeft = getState().playhead * live.current.pps; // re-pin: the line must still be on the same moment
          requestAnimationFrame(() => (pinching.current = false));
        });
      if (e.touches.length === 0) lock = null;
      if (e.touches.length < 2) (pinch = null, (pinching.current = false));
      if (e.touches.length === 0 && trail.length) {
        // a slow, careful scroll must stop exactly where the finger stopped (no slide from the lift-off)
        const a = trail[0]!;
        const b = trail[trail.length - 1]!;
        const v = b.t > a.t ? Math.abs(b.x - a.x) / (b.t - a.t) : 0;
        if (v < 0.35 || performance.now() - b.t > 60) {
          const left = b.left;
          el.style.overflowX = 'hidden';
          el.scrollLeft = left;
          requestAnimationFrame(() => (el.style.overflowX = ''));
        }
      }
      trail = [];
    };
    // a mouse has no touch scrolling: drag sideways to seek, up or down to zoom (same rule as a finger)
    let pm: { id: number; x: number; left: number; y: number; pps0: number; axis: 'x' | 'y' | null; onStrip: boolean } | null = null;
    const mDown = (e: PointerEvent) => {
      const onStrip = !!(e.target as Element).closest('.strip-clip');
      if ((e.pointerType !== 'mouse' && e.pointerType !== 'pen') || e.button !== 0 || (e.target as Element).closest('.trim-h') || (!onStrip && (e.target as Element).closest('button'))) return;
      touching.current = true;
      engine.holding = true;
      clearTimeout(settle.current);
      pm = { id: e.pointerId, x: e.clientX, left: el.scrollLeft, y: e.clientY, pps0: live.current.pps, axis: null, onStrip };
    };
    const mMove = (e: PointerEvent) => {
      if (!pm || pm.id !== e.pointerId) return;
      if (e.buttons === 0) return void (pm = null);
      if (boxRef.current?.active) return void (pm = null);
      const dx = e.clientX - pm.x;
      const dy = e.clientY - pm.y;
      if (pm.axis === null) {
        if (Math.hypot(dx, dy) < 8) return;
        pm.axis = Math.abs(dy) > Math.abs(dx) * 1.2 ? 'y' : 'x';
        // on a strip a sideways mouse drag belongs to the strip (slide, move); only the vertical drag is the zoom
        if (pm.onStrip && pm.axis === 'x') return void (pm = null);
        if (pm.axis === 'y') {
          if (st.current && !st.current.active) (clearTimeout(st.current.timer), (st.current = null));
          if (slipRef.current && !slipRef.current.active) slipRef.current = null;
        }
        if (boxRef.current) (clearTimeout(boxRef.current.timer), (boxRef.current = null));
        swallow.current = true;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* gone */
        }
      }
      if (pm.axis === 'x') el.scrollLeft = pm.left - dx;
      else {
        pinching.current = true;
        setPps(Math.max(MIN_PPS, Math.min(MAX_PPS, pm.pps0 * Math.exp(-dy / 140))));
      }
    };
    const mUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') (touching.current = false), armSettle(), engine.letGo();
      if (!pm || pm.id !== e.pointerId) return;
      const was = pm.axis;
      pm = null;
      if (was) window.setTimeout(() => ((swallow.current = false), (pinching.current = false)), 60);
    };
    // a pen is handled like a mouse (drag to seek or zoom). The browser would otherwise pan the timeline itself and cancel
    // the hold for box select, so while a pen hovers over the timeline the browser's own panning is switched off
    // (a pen has no touchmove events that could be cancelled later, unlike a finger)
    const penNear = (e: PointerEvent) => {
      if (e.pointerType === 'pen') el.style.touchAction = 'none';
    };
    const penAway = (e: PointerEvent) => {
      if (e.pointerType === 'pen' && e.buttons === 0) el.style.touchAction = '';
    };
    const fingerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') el.style.touchAction = '';
    };
    el.addEventListener('pointerover', penNear);
    el.addEventListener('pointermove', penNear);
    el.addEventListener('pointerleave', penAway);
    el.addEventListener('pointerdown', fingerDown, true);
    el.addEventListener('pointerdown', mDown);
    el.addEventListener('pointermove', mMove);
    el.addEventListener('pointerup', mUp);
    el.addEventListener('pointercancel', mUp);
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', mv, { passive: false });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
    const noMenu = (e: Event) => e.preventDefault(); // a pen held down would otherwise open a context menu and cancel the hold
    el.addEventListener('contextmenu', noMenu);
    return () => {
      el.removeEventListener('contextmenu', noMenu);
      el.removeEventListener('pointerover', penNear);
      el.removeEventListener('pointermove', penNear);
      el.removeEventListener('pointerleave', penAway);
      el.removeEventListener('pointerdown', fingerDown, true);
      el.removeEventListener('pointerdown', mDown);
      el.removeEventListener('pointermove', mMove);
      el.removeEventListener('pointerup', mUp);
      el.removeEventListener('pointercancel', mUp);
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', mv);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);

  // ---------- box select: hold on empty space, then drag a box over the strips ----------

  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const boxRef = useRef<{ id: number; sx: number; sy: number; x0: number; y0: number; x1: number; y1: number; timer: number; active: boolean; cx: number; cy: number; raf: number } | null>(null);
  const toContent = (cx: number, cy: number) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    return { x: cx - r.left + el.scrollLeft, y: cy - r.top + el.scrollTop };
  };
  /** while the box is being drawn, a finger near an edge scrolls the timeline (like moving a strip) and the box grows with it */
  const boxFrame = () => {
    const b = boxRef.current;
    const el = scroller.current;
    if (!b || !b.active || !el) return;
    const r = el.getBoundingClientRect();
    if (b.cx < r.left + EDGE) el.scrollLeft -= Math.ceil(((r.left + EDGE - b.cx) / EDGE) * 14);
    else if (b.cx > r.right - EDGE) el.scrollLeft += Math.ceil(((b.cx - (r.right - EDGE)) / EDGE) * 14);
    if (b.cy < r.top + RULER + 14) el.scrollTop -= Math.ceil(Math.min(1, (r.top + RULER + 14 - b.cy) / 40) * 2.5);
    else if (b.cy > r.bottom - 24) el.scrollTop += Math.ceil(Math.min(1, (b.cy - (r.bottom - 24)) / 40) * 2.5);
    const p = toContent(b.cx, b.cy);
    b.x1 = p.x;
    b.y1 = p.y;
    setBox({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
    b.raf = requestAnimationFrame(boxFrame);
  };
  const boxDown = (e: PointerEvent) => {
    const el = scroller.current;
    if (live.current.clips.length === 0) return; // nothing to pick in an empty project (the preview does the same)
    if (!el || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as Element).closest('.strip-clip, .trim-h, .gap-trash, .tl-ruler')) return;
    const p = toContent(e.clientX, e.clientY);
    const b = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: p.x, y0: p.y, x1: p.x, y1: p.y, timer: 0, active: false, cx: e.clientX, cy: e.clientY, raf: 0 };
    boxRef.current = b;
    b.timer = window.setTimeout(() => {
      if (boxRef.current !== b) return;
      b.active = true;
      engine.pause();
      try {
        haptic(12);
      } catch {
        /* not supported */
      }
      try {
        el.setPointerCapture(b.id);
      } catch {
        /* the pointer is gone */
      }
      setBox({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
      hold('Box select');
      b.raf = requestAnimationFrame(boxFrame);
    }, HOLD_MS);
  };
  const boxMove = (e: PointerEvent) => {
    const b = boxRef.current;
    if (!b || e.pointerId !== b.id) return;
    if (!b.active) {
      if (Math.hypot(e.clientX - b.sx, e.clientY - b.sy) > WOBBLE) {
        clearTimeout(b.timer); // a scroll, not a box
        boxRef.current = null;
      }
      return;
    }
    b.cx = e.clientX;
    b.cy = e.clientY;
    const p = toContent(e.clientX, e.clientY);
    b.x1 = p.x;
    b.y1 = p.y;
    setBox({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
  };
  const boxUp = (e: PointerEvent) => {
    const b = boxRef.current;
    if (!b || e.pointerId !== b.id) return;
    clearTimeout(b.timer);
    cancelAnimationFrame(b.raf);
    boxRef.current = null;
    if (!b.active) return;
    releaseHud();
    setBox(null);
    swallow.current = true;
    setTimeout(() => (swallow.current = false), 0);
    if (e.type !== 'pointerup') return;
    const { clips: cs, pps: k, lanes: ln, padL: pl } = live.current;
    const l = Math.min(b.x0, b.x1);
    const r = Math.max(b.x0, b.x1);
    const t = Math.min(b.y0, b.y1);
    const bt = Math.max(b.y0, b.y1);
    const hits = cs.filter((c) => {
      const row = ln.indexOf(c.track);
      if (row < 0) return false;
      const x = pl + c.at * k;
      const w = Math.max(14, clipDuration(c) * k);
      const y = rowTop(row);
      return x < r && x + w > l && y < bt && y + ROW > t;
    });
    if (hits.length === 0) return;
    // a second box adds to what is already picked
    const ids = [...new Set([...(getState().multi.length ? getState().multi : []), ...hits.map((c) => c.id)])];
    // a box that catches a single strip just picks it: multi-selection starts with two
    if (ids.length === 1) {
      const k1 = cs.findIndex((c) => c.id === ids[0]);
      if (k1 >= 0) return selectClip(k1, { keepPlayhead: true });
    }
    setMulti(ids);
  };

  // ---------- moving a strip ----------

  /** nearest snap for a strip starting at `at` that is `dur` long: where it goes, and the edge it lines up with */
  const snap = (index: number, at: number, dur: number): { at: number; guide: number | null } => {
    const { clips: cs, pps: k, playhead: ph } = live.current;
    const limit = SNAP_PX / k;
    const points = [0, ph];
    cs.forEach((c, i) => {
      if (i !== index && !getState().multi.includes(c.id)) points.push(c.at, clipEnd(c));
    });
    let best = at;
    let guide: number | null = null;
    let d = limit;
    for (const p of points) {
      for (const cand of [p, p - dur]) {
        const dd = Math.abs(at - cand);
        if (dd < d) (d = dd), (best = cand), (guide = p);
      }
    }
    return { at: Math.max(0, best), guide };
  };

  const frame = () => {
    const s = st.current;
    const el = scroller.current;
    if (!s || !s.active || !el) return;
    // everything that changes while lanes are added (lane count, strip height) is read fresh: this function keeps running from an old render
    const { clips: cs, pps: k, lanes: ln, height: h, ROW } = live.current;
    const clip = cs[s.i];
    if (!clip) return;
    const r = el.getBoundingClientRect();
    let vx = 0;
    if (s.x < r.left + EDGE) vx = -Math.ceil(((r.left + EDGE - s.x) / EDGE) * 14);
    else if (s.x > r.right - EDGE) vx = Math.ceil(((s.x - (r.right - EDGE)) / EDGE) * 14);
    if (vx) el.scrollLeft += vx;
    let vy = 0;
    if (s.y < r.top + RULER + 14) vy = -Math.ceil(Math.min(1, (r.top + RULER + 14 - s.y) / 40) * 2.5);
    else if (s.y > r.bottom - 24) vy = Math.ceil(Math.min(1, (s.y - (r.bottom - 24)) / 40) * 2.5);
    if (vy) el.scrollTop += vy;
    const raw = s.at0 + (s.x - s.x0 + (el.scrollLeft - s.scroll0)) / k;
    const sn = snap(s.i, raw, clipDuration(clip));
    let at = sn.at;
    // a picked group moves as one: the front-most member stops at 0 and so does everyone else, while the finger keeps moving
    const ms = getState().multi;
    if (ms.includes(clip.id)) {
      const first = cs.reduce((m, c) => (ms.includes(c.id) ? Math.min(m, c.at) : m), Infinity);
      if (Number.isFinite(first)) at = Math.max(at, clip.at - first);
    }
    // the strip follows the finger; held on the free lane at the top or bottom edge, more lanes open one by one
    const fingerY = s.y - r.top + el.scrollTop;
    const top = Math.max(RULER, Math.min(h - ROW - 4, fingerY - (s.grab ?? 0.5) * ROW));
    let row = Math.round((top - RULER) / (ROW + GAP));
    row = Math.max(0, Math.min(ln.length - 1, row));
    const track = ln[row]!;
    const zone = row === 0 ? 'top' : row === ln.length - 1 ? 'bottom' : null;
    const now = performance.now();
    if (zone !== s.edge) (s.edge = zone), (s.edgeAt = now);
    else if (zone && now - (s.edgeAt ?? now) > 420) {
      s.edgeAt = now;
      setExt((x) => (zone === 'top' ? { ...x, hi: x.hi + 1 } : { ...x, lo: x.lo + 1 }));
      // a new lane at the bottom comes into view by scrolling down to it
      if (zone === 'bottom') requestAnimationFrame(() => requestAnimationFrame(() => (el.scrollTop = el.scrollHeight)));
    }
    moveTick.current(sn.guide);
    setMove({ index: s.i, at, track, top, guide: sn.guide });
    s.raf = requestAnimationFrame(frame);
  };

  const finish = (commit: boolean) => {
    const s = st.current;
    if (!s) return;
    clearTimeout(s.timer);
    cancelAnimationFrame(s.raf);
    st.current = null;
    setExt({ hi: 0, lo: 0 });
    if (s.active) {
      swallow.current = true;
      setTimeout(() => (swallow.current = false), 0);
      setMove((d) => {
        if (commit && d) {
          const c = live.current.clips[d.index];
          if (c && (d.at !== c.at || d.track !== c.track)) (getState().multi.includes(c.id) ? moveMulti : moveClipTo)(d.index, d.at, d.track);
        }
        return null;
      });
    }
  };

  const down = (i: number) => (e: PointerEvent) => {
    {
      const g = getState();
      const c0 = clips[i];
      if (g.handles && g.selected === i && g.multi.length === 0 && c0 && slippable(g.project.media[c0.mediaId]) && !(e.target as Element).closest('.trim-h')) {
        slipRef.current = { id: e.pointerId, i, x0: e.clientX, y0: e.clientY, base: { start: c0.start, end: c0.end }, active: false, cur: { start: c0.start, end: c0.end } };
        return;
      }
    }
    if (st.current) finish(false);
    const el = scroller.current;
    const clip = clips[i];
    if (!el || !clip) return;
    const target = e.currentTarget as HTMLElement;
    const s: NonNullable<typeof st.current> = { id: e.pointerId, i, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, at0: clip.at, track0: clip.track, scroll0: el.scrollLeft, scrollTop0: el.scrollTop, timer: 0, active: false, raf: 0 };
    st.current = s;
    s.timer = window.setTimeout(() => {
      s.active = true;
      s.scroll0 = el.scrollLeft;
      s.scrollTop0 = el.scrollTop;
      s.x0 = s.x;
      s.y0 = s.y;
      engine.pause();
      if (!getState().multi.includes(clip.id)) selectClip(i, { keepPlayhead: true });
      try {
        target.setPointerCapture(s.id);
      } catch {
        /* the pointer is gone */
      }
      try {
        haptic(12);
      } catch {
        /* not supported */
      }
      const row = live.current.lanes.indexOf(clip.track);
      s.grab = (s.y0 - el.getBoundingClientRect().top + el.scrollTop - rowTop(row)) / ROW;
      setMove({ index: i, at: clip.at, track: clip.track, top: rowTop(row), guide: null });
      s.raf = requestAnimationFrame(frame);
    }, HOLD_MS);
  };
  const onMove = (e: PointerEvent) => {
    const sp = slipRef.current;
    if (sp && e.pointerId === sp.id) {
      const dx = e.clientX - sp.x0;
      if (!sp.active) {
        if (Math.abs(dx) <= WOBBLE) return;
        sp.active = true;
        engine.pause();
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(sp.id);
        } catch {
          /* the pointer is gone */
        }
      }
      const clip = live.current.clips[sp.i];
      const m = live.current.media[clip?.mediaId ?? ''];
      if (!clip) return;
      const len = sp.base.end - sp.base.start;
      const dur = m?.duration ?? clip.end;
      // the picture follows the finger: dragging right shows earlier parts of the file
      const start = Math.max(0, Math.min(Math.max(0, dur - len), sp.base.start - (dx / live.current.pps) * clip.speed));
      sp.cur = { start, end: start + len };
      setTrim({ index: sp.i, at: clip.at, start, end: start + len });
      setSlip(sp.i);
      hold(`Offset ${fmtTime(start, 2)}`);
      engine.scrubSource(sp.i, start, false);
      return;
    }
    const s = st.current;
    if (!s || e.pointerId !== s.id) return;
    s.x = e.clientX;
    s.y = e.clientY;
    if (!s.active && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) > WOBBLE) {
      clearTimeout(s.timer); // a scroll, not a pick-up
      st.current = null;
    }
  };
  const up = (e: PointerEvent) => {
    const sp = slipRef.current;
    if (sp && e.pointerId === sp.id) {
      slipRef.current = null;
      if (sp.active) {
        swallow.current = true;
        setTimeout(() => (swallow.current = false), 0);
        setTrim(null);
        setSlip(null);
        releaseHud();
        if (e.type === 'pointerup' && (sp.cur.start !== sp.base.start || sp.cur.end !== sp.base.end)) updateClip(sp.i, { start: sp.cur.start, end: sp.cur.end });
        void engine.showAt(getState().playhead);
      }
      return;
    }
    const s = st.current;
    if (s && e.pointerId === s.id) finish(e.type === 'pointerup');
  };

  // ---------- trimming with the handles of the selected strip ----------

  const trimRef = useRef<{ id: number; i: number; side: 'left' | 'right'; x0: number; base: { at: number; start: number; end: number }; cur: Trim; guide?: number | null } | null>(null);
  const [trimGuide, setTrimGuide] = useState<number | null>(null);

  const solveTrim = (t: NonNullable<typeof trimRef.current>, dx: number): Trim => {
    const clip = live.current.clips[t.i]!;
    const m = live.current.media[clip.mediaId];
    const dur = m?.duration ?? clip.end;
    const k = live.current.pps;
    let dt = dx / k; // timeline seconds
    const b = t.base;
    // the edge being dragged sticks to the playhead, the start, and the edges of other strips
    const edge0 = t.side === 'left' ? b.at : b.at + (b.end - b.start) / clip.speed;
    const lim = SNAP_PX / k;
    let best = lim;
    let hitAt: number | null = null;
    const pts = [0, live.current.playhead];
    live.current.clips.forEach((c, i) => {
      if (i !== t.i) pts.push(c.at, clipEnd(c));
    });
    for (const p of pts) {
      const dd = Math.abs(edge0 + dt - p);
      if (dd < best) (best = dd), (hitAt = p);
    }
    if (hitAt != null) dt = hitAt - edge0;
    t.guide = hitAt;
    if (t.side === 'left') {
      dt = Math.max(dt, -b.at, -b.start / clip.speed);
      dt = Math.min(dt, (b.end - MIN_CLIP - b.start) / clip.speed);
      return { index: t.i, at: b.at + dt, start: b.start + dt * clip.speed, end: b.end };
    }
    dt = Math.max(dt, (b.start + MIN_CLIP - b.end) / clip.speed);
    dt = Math.min(dt, (dur - b.end) / clip.speed);
    return { index: t.i, at: b.at, start: b.start, end: b.end + dt * clip.speed };
  };
  const trimDown = (i: number, side: 'left' | 'right') => (e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const clip = clips[i];
    if (!clip) return;
    engine.pause();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone */
    }
    const t = { id: e.pointerId, i, side, x0: e.clientX, base: { at: clip.at, start: clip.start, end: clip.end }, cur: { index: i, at: clip.at, start: clip.start, end: clip.end } };
    trimRef.current = t;
    setTrim(t.cur);
  };
  const trimMove = (e: PointerEvent) => {
    const t = trimRef.current;
    if (!t || e.pointerId !== t.id) return;
    t.cur = solveTrim(t, e.clientX - t.x0);
    setTrim(t.cur);
    hold(`Trim ${fmtTime((t.cur.end - t.cur.start) / (live.current.clips[t.i]?.speed ?? 1), 2)}`);
    trimTick.current(t.guide ?? null);
    setTrimGuide(t.guide ?? null);
    engine.scrubSource(t.i, t.side === 'left' ? t.cur.start : Math.max(t.cur.start, t.cur.end - 0.05), false);
  };
  const trimUp = (e: PointerEvent) => {
    const t = trimRef.current;
    if (!t || e.pointerId !== t.id) return;
    trimRef.current = null;
    releaseHud();
    setTrim(null);
    setTrimGuide(null);
    const c = t.cur;
    // a tap on a handle (no drag) puts the handles away, which is how a very short strip gets them back off
    if (e.type === 'pointerup' && Math.abs(e.clientX - t.x0) < 6) set({ handles: false });
    else if (e.type === 'pointerup' && (c.at !== t.base.at || c.start !== t.base.start || c.end !== t.base.end)) updateClip(t.i, { at: t.guide != null ? c.at : Math.round(c.at * 100) / 100, start: c.start, end: c.end });
    void engine.showAt(getState().playhead);
  };

  // tapping empty space between two strips picks that gap (red box with a trash can)
  const laneTap = (e: MouseEvent, track: number) => {
    if (swallow.current || e.target !== e.currentTarget) return;
    if (getState().gap?.lane) return; // the picked lane handles its own tap
    const el = scroller.current;
    if (!el) return;
    const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
    const t = (x - padL) / pps;
    const g = gapAt(clips, track, t);
    if (!g && getState().multi.length === 0 && laneRemovable(live.current.clips, track)) {
      // an empty lane between used ones: pick the whole lane (tap it again to take it out)
      engine.pause();
      set({ gap: { track, from: 0, to: Math.max(1, (live.current.width - padL) / pps), lane: true }, drawer: null, selected: -1, handles: false, boxMode: false });
      return;
    }
    if (!g || getState().multi.length > 0) {
      deselect(); // empty lane space (or any gap while several strips are picked): nothing is selected any more
      return;
    }
    engine.pause();
    set({ gap: g, drawer: null, selected: -1, handles: false, boxMode: false });
  };
  // ---------- the middle bar is also the handle that trades height between preview and timeline ----------
  const barDrag = useRef<{ id: number; y0: number; h0: number; lo: number; hi: number; thr: number; grip: boolean; armed: boolean; moved: boolean; cur: number; pts: { t: number; y: number }[] } | null>(null);
  const [arrow, setArrow] = useState<{ x: number; y: number; ping: boolean } | null>(null);
  const arrowTimer = useRef(0);
  const setTlH = (h: number) => window.dispatchEvent(new CustomEvent('pc-tl-height', { detail: h }));
  const saveTlH = () => {
    try {
      localStorage.setItem('pocket-cut-nla:tl-height', String(Math.round(parseFloat(getComputedStyle(document.querySelector('.app')!).getPropertyValue('--tl-h')) || 200)));
    } catch {
      /* ignore */
    }
  };
  const openFocus = () => {
    set({ focus: true, drawer: null, sheet: 'none' });
  };
  const barDown = (e: PointerEvent) => {
    if (!(e.target as Element).closest('.tl-grip')) return; // only the grip is a divider; the buttons do nothing here
    const app = document.querySelector('.app') as HTMLElement | null;
    const stage = document.querySelector('.stage') as HTMLElement | null;
    if (!app || !stage) return;
    clearTimeout(arrowTimer.current);
    const gr = (e.target as Element).closest('.tl-grip')!.getBoundingClientRect();
    setArrow({ x: gr.left + gr.width / 2, y: e.clientY, ping: false });
    const h0 = parseFloat(getComputedStyle(app).getPropertyValue('--tl-h')) || 200;
    const cs = getComputedStyle(stage);
    const px = (v: string) => parseFloat(v) || 0;
    // the timeline can shrink to nothing and grow until the preview is gone
    const hi = Math.max(0, h0 + stage.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom));
    // less than one lane (under the ruler) still showing: letting go opens the full preview
    barDrag.current = { id: e.pointerId, y0: e.clientY, h0, lo: 0, hi, thr: RULER + ROW, grip: true, armed: false, moved: false, cur: h0, pts: [{ t: e.timeStamp, y: e.clientY }] };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone */
    }
  };
  const barMove = (e: PointerEvent) => {
    const d = barDrag.current;
    if (!d || d.id !== e.pointerId) return;
    const raw = d.h0 + (d.y0 - e.clientY);
    if (Math.abs(e.clientY - d.y0) > 6) d.moved = true;
    d.pts.push({ t: e.timeStamp, y: e.clientY });
    setArrow((a) => (a ? { ...a, y: e.clientY } : a));
    if (d.pts.length > 8) d.pts.shift();
    d.armed = raw < d.thr;
    d.cur = Math.round(Math.max(d.lo, Math.min(d.hi, raw)));
    setTlH(d.cur);
  };
  const barUp = (e: PointerEvent) => {
    const d = barDrag.current;
    if (!d || d.id !== e.pointerId) return;
    barDrag.current = null;
    // let go after dragging: the arrow goes. A plain tap: the arrow bobs up and down once to show what the handle does
    if (e.type === 'pointerup' && !d.moved && d.grip) {
      setArrow((a) => (a ? { ...a, ping: true } : a));
      arrowTimer.current = window.setTimeout(() => setArrow(null), 1000);
    } else setArrow(null);
    if (d.armed && e.type === 'pointerup') return openFocus();
    saveTlH();
  };
  /** Play deselects everything first; the layout settles for a couple of frames (the timeline would read that as a hand scroll and stop) and then it plays */
  const startStop = () => {
    if (getState().playing) return say('Pause'), engine.pause();
    const g = getState();
    const needs = g.selected >= 0 || g.multi.length > 0 || !!g.gap || !!g.drawer;
    say('Play');
      if (!needs) return void engine.play();
    deselect();
    requestAnimationFrame(() => requestAnimationFrame(() => void engine.play()));
  };
  const gapRow = gap ? lanes.indexOf(gap.track) : -1;

  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200].find((s) => s * pps >= 56) ?? 1200;
  const ticks: number[] = [];
  for (let t = 0; padL + t * pps + 40 <= width; t += step) ticks.push(t);

  return (
    <div class={`tl ${move ? 'dragging' : ''}`}>
      <div class="tl-bar" onPointerDown={barDown} onPointerMove={barMove} onPointerUp={barUp} onPointerCancel={barUp}>
        <button class="play" onClick={startStop} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause /> : <Play />}
        </button>
        <div class="tl-left">
        </div>
        {!hasSel && !gap ? (
          <button class="tl-btn" disabled={tight} onClick={optimizeWithFeedback} aria-label={tight ? "Simplify timeline (the lanes are already as tight as they can be)" : "Simplify timeline"}>
            <Simplify />
          </button>
        ) : (
          <button class="tl-btn" onClick={() => (gap ? (gap.lane ? removeLane() : removeGap()) : (engine.pause(), deleteClip(selected)))} aria-label={gap ? (gap.lane ? "Remove the empty lane" : "Remove the gap") : "Delete the selected clip"}>
            <Trash />
          </button>
        )}
        <button class="tl-btn" disabled={!canUndo} onClick={undo} aria-label="Undo">
          <Undo />
        </button>
        <button class="tl-btn" disabled={!canRedo} onClick={redo} aria-label="Redo">
          <Redo />
        </button>
        <button
          class="tl-btn"
          disabled={!hasSel && activeAt(clips, playhead).length === 0}
          onClick={() => {
            if (!splitAtPlayhead()) toast('Move the yellow line into this clip, away from its edges, to cut there.');
          }}
          aria-label="Split at the yellow line"
        >
          <GapH />
        </button>
        {!hasSel ? (
          <button class="tl-btn" onClick={() => (engine.pause(), void pasteClipboard('time'))} aria-label="Paste from the clipboard">
            <PasteIcon />
          </button>
        ) : (
          <button class="tl-btn" onClick={() => (engine.pause(), duplicateClip(selected))} aria-label="Duplicate the selected clip">
            <Copy />
          </button>
        )}
        <div class="tl-grip" role="separator" aria-orientation="horizontal" aria-label="Pane divider: drag up or down to resize the preview and the timeline">
          <span aria-hidden="true">⇕</span>
        </div>
      </div>
      {arrow && (
        <div class={`div-arrow ${arrow.ping ? 'ping' : ''}`} style={{ left: `${arrow.x}px`, top: `${arrow.y}px` }} aria-hidden="true">
          <svg viewBox="0 0 24 180" width="24" height="180">
            <path d="M12 6V174M3 16L12 4l9 12M3 164l9 12 9-12" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M12 6V174M3 16L12 4l9 12M3 164l9 12 9-12" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
      )}
      <div class="tl-wrap">
        <div class="tl-scroll" ref={scroller} onScroll={onScroll} onPointerDown={boxDown} onPointerMove={boxMove} onPointerUp={boxUp} onPointerCancel={boxUp}>
          <div class="tl-inner" style={{ width: `${width}px`, minHeight: `${height}px` }} onClick={(e) => e.target === e.currentTarget && deselect()}>
            <div class="tl-ruler" style={{ height: `${RULER}px` }}>
              {ticks.map((t) => (
                <span key={t} class="tl-tick num" style={{ left: `${padL + t * pps}px` }}>
                  {showFrames ? Math.round(t * fps) : fmtTime(t, 0)}
                </span>
              ))}
            </div>
            <div class="tl-void" style={{ left: 0, width: `${padL}px` }} />
            <div class="tl-void" style={{ left: `${padL + total * pps}px`, right: 0 }} />
            {lanes.map((track, row) => (
              <div key={track} data-track={track} class={`tl-lane ${move?.track === track ? 'target' : ''}`} style={{ top: `${rowTop(row)}px`, height: `${ROW}px` }} onClick={(e) => laneTap(e, track)}>
                <span class="tl-lane-name">{track}</span>
              </div>
            ))}
            {gap && gapRow >= 0 && (() => {
              // the bin sits in the middle of the part of the red box you can actually see
              const bl = padL + gap.from * pps;
              const bw = (gap.to - gap.from) * pps;
              const v0 = playhead * pps;
              const lo = Math.max(bl, v0);
              const hi = Math.min(bl + bw, v0 + viewW);
              const mid = hi > lo ? (lo + hi) / 2 - bl : bw / 2;
              const trashX = bw <= 40 ? bw / 2 : Math.max(20, Math.min(bw - 20, mid)); // a box narrower than the bin holds it dead centre
              return (
              <div class={`tl-gap ${gap.lane ? 'lane' : ''}`} style={{ left: `${padL + gap.from * pps}px`, width: `${(gap.to - gap.from) * pps}px`, top: `${rowTop(gapRow)}px`, height: `${ROW}px` }} onClick={gap.lane ? () => removeLane() : undefined}>
                <button class="gap-trash" style={{ left: `${trashX}px` }} aria-label={gap.lane ? `Remove empty lane ${gap.track}` : `Remove the ${fmtTime(gap.to - gap.from)} gap`} onClick={(e) => (gap.lane ? (e.stopPropagation(), removeLane()) : removeGap())}>
                  <Trash />
                </button>
              </div>
              );
            })()}
            {box && <div class="tl-box" style={{ left: `${Math.min(box.x0, box.x1)}px`, top: `${Math.min(box.y0, box.y1)}px`, width: `${Math.abs(box.x1 - box.x0)}px`, height: `${Math.abs(box.y1 - box.y0)}px` }} />}
            {trimGuide != null && <div class="snap-guide" style={{ left: `${padL + trimGuide * pps}px` }} />}
            {move?.guide != null && <div class="snap-guide" style={{ left: `${padL + move.guide * pps}px` }} />}
            {slip != null && trim && clips[slip] && (() => {
              const c = clips[slip]!;
              const m = media[c.mediaId];
              const row = lanes.indexOf(c.track);
              if (row < 0) return null;
              const dur = m?.duration ?? c.end;
              return <div class="slip-ghost" style={{ left: `${padL + c.at * pps - (trim.start / c.speed) * pps}px`, top: `${rowTop(row)}px`, width: `${(dur / c.speed) * pps}px`, height: `${ROW}px` }} />;
            })()}
            {clips.map((c, i) => {
              const m = media[c.mediaId];
              const lead = move ? clips[move.index] : undefined;
              const follows = !!move && !!lead && move.index !== i && multi.includes(c.id) && multi.includes(lead.id);
              const moving = move?.index === i || follows;
              const tr = trim?.index === i ? trim : null;
              const at = follows ? Math.max(0, c.at + (move!.at - lead!.at)) : moving ? move!.at : (tr?.at ?? c.at);
              const start = tr?.start ?? c.start;
              const end = tr?.end ?? c.end;
              const track = moving && !follows ? move!.track : c.track;
              const row = lanes.indexOf(track);
              if (row < 0) return null;
              const top = follows ? Math.max(RULER, rowTop(row) + (move!.top - rowTop(lanes.indexOf(lead!.track)))) : moving ? move!.top : rowTop(row);
              const url = thumbUrl(c.mediaId);
              const p = progress[c.mediaId];
              const audio = isAudio(m);
              const w = Math.max(14, ((end - start) / c.speed) * pps);
              const inMulti = multi.includes(c.id);
              const on = multi.length > 0 ? inMulti : i === selected && !tapWait;
              const baking = bakes[keyOf(c)];
              const wave = audio ? waves[c.mediaId] : undefined;
              return (
                <button
                  key={c.id}
                  role="option"
                  aria-selected={on}
                  class={`strip-clip ${on ? 'on' : ''} ${inMulti ? 'multi' : ''} ${moving ? 'lifted' : ''} ${audio ? 'audio' : ''} ${m?.text ? 'texty' : ''} ${m?.solid ? 'solid' : ''} ${baking !== undefined ? 'baking' : ''} ${p !== undefined ? 'generating' : ''} ${on && handles && multi.length === 0 ? 'edit' : ''} ${slippable(m) ? 'vid' : ''} ${snapAt != null && Math.abs(c.at - snapAt) < 0.02 ? 'snap-l' : ''} ${snapAt != null && Math.abs(c.at + clipDuration(c) - snapAt) < 0.02 ? 'snap-r' : ''}`}
                  style={{ left: `${padL + at * pps}px`, top: `${top}px`, width: `${w}px`, height: `${ROW}px`, ...(m?.solid ? { background: m.solid } : {}) }}
                  onPointerDown={down(i)}
                  onPointerMove={onMove}
                  onPointerUp={up}
                  onPointerCancel={up}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={() => {
                    if (swallow.current) return;
                    engine.pause();
                    if (getState().multi.length > 0) return toggleMulti(i);
                    // a second tap on the same strip within the window is a double tap: zoom so it spans the middle half of the timeline
                    if (tapped.current === c.id) {
                      tapped.current = null;
                      clearTimeout(tapTimer.current);
                      endTapWait();
                      if (getState().selected !== i) selectClip(i, { keepPlayhead: true });
                      return glideTo(i, true);
                    }
                    tapped.current = c.id;
                    armTapWait();
                    if (!on) (selectClip(i, { keepPlayhead: true }), glideTo(i, false));
                    // tapping the picked strip swaps select and edit mode, once it is clear that no second tap follows
                    clearTimeout(tapTimer.current);
                    tapTimer.current = window.setTimeout(() => {
                      tapped.current = null;
                      if (on && getState().selected === i) (say(getState().handles ? 'Select mode' : 'Edit mode'), set({ handles: !getState().handles }));
                    }, DOUBLE_MS);
                  }}
                >
                  {wave && <Wave peaks={wave} from={start} to={end} width={w} />}
                  {baking !== undefined && (
                    <span class="strip-pie" style={{ left: `${pieX(padL + at * pps, w)}px` }} title="Preparing the sound for the preview">
                      <Pie value={baking} size={Math.max(14, Math.min(22, ROW - 10))} />
                    </span>
                  )}
                  {url && !m?.text && <span class="strip-thumb" style={{ backgroundImage: `url("${url}")`, backgroundPosition: `${-((tr?.at ?? c.at) - c.at) * pps + ((c.start - start) / c.speed) * pps}px center` }} />}
                  {ROW >= 30 && (
                    <span class="strip-time num">
                      {c.speed !== 1 ? `${c.speed}× · ` : ''}
                      {fmtTime((end - start) / c.speed)}
                    </span>
                  )}
                  <span class="strip-label num">{(m?.name ?? '') + (p !== undefined ? ` (generating preview ${Math.round(p * 100)}%)` : '')}</span>
                  {on && handles && !moving && (
                    <>
                      <span class="trim-h left" onPointerDown={trimDown(i, 'left')} onPointerMove={trimMove} onPointerUp={trimUp} onPointerCancel={trimUp} onClick={(e) => e.stopPropagation()} />
                      <span class="trim-h right" onPointerDown={trimDown(i, 'right')} onPointerMove={trimMove} onPointerUp={trimUp} onPointerCancel={trimUp} onClick={(e) => e.stopPropagation()} />
                    </>
                  )}
                </button>
              );
            })}
            {ghosts.map((g, k) => {
              const row = lanes.indexOf(g.track);
              if (row < 0) return null;
              return <div key={`g${k}`} class="drop-ghost" style={{ left: `${padL + g.at * pps}px`, top: `${rowTop(row)}px`, width: `${g.dur * pps}px`, height: `${ROW}px` }} aria-hidden="true" />;
            })}
          </div>
        </div>
        <button
          class="tl-time num"
          style={{ left: `${padL}px` }}
          aria-label={showFrames ? 'Show time as minutes and seconds' : 'Show time as frame number'}
          onClick={() => {
            const v = !showFrames;
            setShowFrames(v);
            try {
              localStorage.setItem('wren:frames', v ? '1' : '0');
            } catch {
              /* storage blocked */
            }
          }}
        >
          {showFrames ? Math.round(playhead * fps) : fmtTime(playhead, 2)}
        </button>
        <div class="tl-playhead" style={{ left: `${padL}px` }} />
      </div>
    </div>
  );
}

/** The loudness outline of the part of a sound file that the strip shows. */
function Wave({ peaks, from, to, width }: { peaks: Uint8Array; from: number; to: number; width: number }) {
  const a = Math.max(0, Math.floor(from * PEAKS_PER_SEC));
  const b = Math.min(peaks.length, Math.ceil(to * PEAKS_PER_SEC));
  const n = b - a;
  if (n < 2) return null;
  // no more than about one bar per 1.5 px
  const group = Math.max(1, Math.floor(n / Math.max(8, width / 1.5)));
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0, x = 0; i < n; i += group, x++) {
    let v = 0;
    for (let k = i; k < Math.min(n, i + group); k++) v = Math.max(v, peaks[a + k]!);
    const h = (v / 255) * 46 + 1;
    top.push(`${x},${50 - h}`);
    bottom.unshift(`${x},${50 + h}`);
  }
  const cols = top.length;
  return (
    <svg class="strip-wave" viewBox={`0 0 ${cols - 1} 100`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={[...top, ...bottom].join(' ')} />
    </svg>
  );
}
