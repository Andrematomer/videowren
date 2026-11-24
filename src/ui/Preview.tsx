import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { endFine as hudEndFine, hide, hold, release as releaseHud, say, startFine } from '../hud.ts';
import { type Rect, baseScale, clampView, fitSegment, shownBox, tapCell, clampZoom, dragView, fitZoom, normAngle, outputSize, pinchView, snapEightCropped, snapView, snapViewCropped, type Pt } from '../geometry.ts';
import { DOUBLE_MS, resetTransform, deselect, getState, selectClip, set, setCrop, setMulti, setViews, toggleMulti, updateClip, useStore } from '../store.ts';
import { localPoint } from '../turn.ts';
import { activeAt, fmtTime, totalOf } from '../timeline.ts';
import type { Clip, Crop, View } from '../types.ts';
import { Pause, Play } from './icons.tsx';
import { haptic, hapticDouble, snapTicker } from '../haptic.ts';

export function Preview() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const busy = useStore((s) => s.busy);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [avail, setAvail] = useState({ w: 0, h: 0 });

  const clip = project.clips[selected];
  const media = clip && project.media[clip.mediaId];

  // the preview always has the shape of the exported video, so the picture can be placed on it directly
  const o = outputSize(project);
  const aspect = o.w / o.h;
  const has = project.clips.length > 0;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const px = (v: string) => parseFloat(v) || 0;
      setAvail({
        w: Math.max(0, el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)),
        h: Math.max(0, el.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom)),
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [has]);

  useEffect(() => {
    if (avail.w === 0) return;
    let w = avail.w;
    let h = w / aspect;
    if (h > avail.h) {
      h = avail.h;
      w = h * aspect;
    }
    setBox({ w: Math.floor(w), h: Math.floor(h) });
  }, [avail.w, avail.h, aspect]);

  // canvas backing store follows the box (crisp on high-DPI screens, capped for speed)
  useEffect(() => {
    const c = canvas.current;
    if (!c || box.w === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(2, Math.round(box.w * dpr));
    c.height = Math.max(2, Math.round(box.h * dpr));
    engine.attach(c);
  }, [box.w, box.h, has]);

  useEffect(() => () => engine.attach(null), []);

  // any edit that changes the picture, not the position in time
  useEffect(() => {
    engine.draw();
  }, [project]);

  // structural changes (import, delete, split, reorder, select): show the right frame again
  const idsKey = project.clips.map((c) => c.id).join();
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (project.clips.length === 0) return;
    }
    void engine.showAt(Math.min(getState().playhead, totalOf(project.clips))).then(() => set({ playhead: engine.tl }));
  }, [idsKey, selected]);

  // nothing added yet: the empty canvas is still drawn, so its shape can be chosen first
  if (!has)
    return (
      <div class="stage" ref={wrap}>
        <div class="frame" style={{ width: `${box.w}px`, height: `${box.h}px`, background: project.settings.background }} />
      </div>
    );

  return (
    <div class="stage" ref={wrap} onClick={(e) => e.target === e.currentTarget && deselect()}>
      <div class="frame" style={{ width: `${box.w}px`, height: `${box.h}px` }}>
        <canvas ref={canvas} style={{ width: `${box.w}px`, height: `${box.h}px` }} />
        {box.w > 0 && <Gestures boxW={box.w} boxH={box.h} />}
        {box.w > 0 && clip && media && <TransformBox boxW={box.w} boxH={box.h} />}
        {box.w > 0 && <GroupBox boxW={box.w} boxH={box.h} />}
        {busy && <div class="overlay-note">{busy}</div>}
        {box.w > 0 && <BuildPies boxW={box.w} boxH={box.h} />}
      </div>
    </div>
  );
}


/**
 * A note in the middle of every picture on screen whose video is still being prepared for the preview. The note belongs to the
 * strip on the canvas (it sits where the picture is); the picture itself shows as a first frame that turns from grey to colour, bottom up.
 */
function BuildPies({ boxW: W, boxH: H }: { boxW: number; boxH: number }) {
  // which pictures on screen are being prepared, and how far (a string, so the box only redraws when that changes)
  const key = useStore((s) => {
    const out: string[] = [];
    for (const i of activeAt(s.project.clips, s.playhead)) {
      const c = s.project.clips[i]!;
      const m = s.project.media[c.mediaId];
      const p = s.proxyProgress[c.mediaId];
      if (m && p !== undefined && m.kind !== 'image' && m.kind !== 'audio') out.push(`${i},${Math.round(p * 100)}`);
    }
    return out.join(';');
  });
  // while a picture is moved, turned, scaled, cropped or sliding into place, the note goes with it, frame by frame
  const [, tick] = useState(0);
  useEffect(() => {
    engine.onDraw = () => {
      if (engine.live || engine.liveMany || engine.cropLive) tick((n) => n + 1);
    };
    return () => {
      engine.onDraw = null;
    };
  });
  if (!key) return null;
  const st = getState();
  return (
    <div class="build-layer">
      {key.split(';').map((k) => {
        const [is, p] = k.split(',');
        const i = Number(is);
        const c = st.project.clips[i];
        const m = c && st.project.media[c.mediaId];
        if (!c || !m) return null;
        const view = engine.liveMany?.get(i) ?? (engine.live && engine.live.index === i ? engine.live.view : c.view);
        const crop = engine.cropLive && engine.cropLive.index === i ? engine.cropLive.crop : c.crop;
        const q = quadOf({ ...c, view, crop }, m, W, H);
        const x = q.reduce((a, b2) => a + b2.x, 0) / q.length;
        const y = q.reduce((a, b2) => a + b2.y, 0) / q.length;
        const w = Math.hypot(q[1]!.x - q[0]!.x, q[1]!.y - q[0]!.y);
        const h = Math.hypot(q[3]!.x - q[0]!.x, q[3]!.y - q[0]!.y);
        const rot = (Math.atan2(q[1]!.y - q[0]!.y, q[1]!.x - q[0]!.x) * 180) / Math.PI;
        // the note belongs to the picture: it is as big as the picture is, and turns with it
        const fs = Math.min(w * 0.12, h * 0.16);
        if (fs < 5) return null;
        return (
          // the note is cut off where the picture is (and where the canvas ends): the part of a picture outside the canvas has no note
          <div key={c.id} class="build-clip" style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, transform: `translate(-50%, -50%) rotate(${rot}deg)` }}>
            <span class="build-note" style={{ fontSize: `${fs}px` }}>
              generating
              <br />
              preview
              <br />
              {p}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

const fmtDeg = (d: number) => `${Math.round(d)}°`;
const MULTI_HOLD_MS = 550; // a still finger on empty canvas or on another picture starts a multi-selection
const HOLD_MS = 900; // on the preview fine control takes twice as long: it is too easy to trigger by accident here
const JITTER = 10;
const FINE = 0.1;

type Clip0 = ReturnType<typeof getState>['project']['clips'][number];

/**
 * Moves the picture on the canvas with the fingers: one finger drags, two fingers pinch to zoom and
 * twist to turn. Magnets pull to the center lines, quarter turns, "whole picture fits" and "fills".
 * Hold still for a moment (at any point of the gesture, with one finger or two) and the picture moves
 * ten times slower, with the magnets off, for exact placement.
 *
 * While fingers are down the view is only drawn (never saved); it is saved when the last finger lifts.
 * Finger bookkeeping is defensive: iOS can lose a touch (for example when a finger slides into the
 * home-bar area) without telling the page, which must never leave a "ghost finger" behind.
 */
function Gestures({ boxW, boxH }: { boxW: number; boxH: number }) {
  const selected = useStore((s) => s.selected);
  const root = useRef<HTMLDivElement>(null);
  const guideV = useRef<HTMLDivElement>(null);
  const guideH = useRef<HTMLDivElement>(null);
  const edgeEls = useRef<Record<string, HTMLElement | null>>({});
  const badge = useRef<HTMLDivElement>(null);
  const pts = useRef(new Map<number, Pt>());
  const arm = useRef(new Map<number, Pt>());
  const base = useRef<{ view: View; a: Pt; b: Pt | null; ids: number[] } | null>(null);
  const live = useRef<View | null>(null);
  // with several strips picked the fingers move all of those that are on screen, as one group
  const groupBase = useRef<{ i: number; v: View }[] | null>(null);
  const groupLive = useRef<[number, View][] | null>(null);
  const groupMembers = (): number[] => {
    const st = getState();
    if (st.multi.length === 0) return [];
    return activeAt(st.project.clips, st.playhead).filter((i) => st.multi.includes(st.project.clips[i]!.id) && st.project.media[st.project.clips[i]!.mediaId]?.kind !== 'audio');
  };
  const fine = useRef(false);
  // edit mode: the box stays where it is and the picture moves inside it, so the crop follows
  const editRegion = useRef<{ cx: number; cy: number; hw: number; hh: number } | null>(null);
  const editCrop = useRef<Crop | null>(null);
  // half and quarter snaps: where the finger is held, and the part of the canvas the picture will fill
  const zone = useRef<{ key: string; x: number; y: number } | null>(null);
  const zoneTimer = useRef(0);
  const snapT = useRef<Rect | null>(null);
  const ghostEl = useRef<HTMLDivElement>(null);
  const gx = useRef<HTMLDivElement>(null);
  const gy = useRef<HTMLDivElement>(null);
  const tap = useRef<{ t: number; x: number; y: number; moved: boolean; multi: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number; prev: number; prevMulti: string[]; prevHandles: boolean } | null>(null);
  const timer = useRef(0);
  const cropTimer = useRef(0);
  const holdTimer = useRef(0);
  const autoPicked = useRef(false);
  const frame = useRef(0);
  const sizes = useRef({ boxW, boxH });
  sizes.current = { boxW, boxH };

  const current = (): { clip: Clip0; media: NonNullable<ReturnType<typeof getState>['project']['media'][string]> } | null => {
    const st = getState();
    const clip = st.project.clips[st.selected];
    const media = clip && st.project.media[clip.mediaId];
    return clip && media ? { clip, media } : null;
  };
  const showBadge = (text: string) => {
    const b = badge.current;
    if (!b) return;
    if (text) return say(text);
    hide();
  };
  const regionTick = useRef(snapTicker()).current;
  const gTick = useRef(snapTicker()).current;
  const lTick = useRef(snapTicker()).current;
  /** `two`: two fingers are on the picture (only then can the zoom be snapping to fit or fill); `deg`: the angle while it is being turned */
  const guides = (s: ReturnType<typeof snapView> | null, two = false, deg: number | null = null) => {
    gTick(s && (s.x || s.y || s.edges.l || s.edges.r || s.edges.t || s.edges.b || s.zoom || s.rot !== null) ? `${!!s.x}${!!s.y}${s.edges.l}${s.edges.r}${s.edges.t}${s.edges.b}${s.zoom}${s.rot}` : null);
    guideV.current?.classList.toggle('on', !!s?.x);
    guideH.current?.classList.toggle('on', !!s?.y);
    for (const k of ['l', 'r', 't', 'b'] as const) edgeEls.current[k]?.classList.toggle('on', !!s?.edges[k]);
    if (fine.current) return;
    if (!s) return showBadge('');
    if (deg !== null) return showBadge(fmtDeg(deg)); // turning: the angle, every degree
    showBadge(two && s.zoom === 'fit' ? 'Fit' : two && s.zoom === 'fill' ? 'Fill' : '');
  };
  /** extra snap lines (the edges and middles of other pictures), in canvas pixels from the top left */
  const lines = (x: number | null, y: number | null) => {
    lTick(x !== null || y !== null ? `${x},${y}` : null);
    const a = gx.current;
    const b = gy.current;
    if (a) (a.style.left = `${x ?? 0}px`), a.classList.toggle('on', x !== null);
    if (b) (b.style.top = `${y ?? 0}px`), b.classList.toggle('on', y !== null);
  };
  /** every picture that is on screen except the moving ones, as snap targets: the sides and middles of what shows */
  const targets = (skip: number[]) => {
    const st = getState();
    const { boxW: W, boxH: H } = sizes.current;
    const xs = [0, W / 2, W];
    const ys = [0, H / 2, H];
    for (const i of activeAt(st.project.clips, st.playhead)) {
      if (skip.includes(i)) continue;
      const c = st.project.clips[i]!;
      const m = st.project.media[c.mediaId];
      if (!m || m.kind === 'audio') continue;
      const r = shownBox(c.view, inkCrop(c, m), m.width, m.height, W, H);
      xs.push(r.x, r.x + r.w / 2, r.x + r.w);
      ys.push(r.y, r.y + r.h / 2, r.y + r.h);
    }
    return { xs, ys };
  };
  const setFineLook = (on: boolean) => {
    fine.current = on;
    root.current?.parentElement?.classList.toggle('fine', on);
    if (on) {
      guideV.current?.classList.remove('on');
      guideH.current?.classList.remove('on');
      showBadge('FINE');
    } else {
      hudEndFine();
      showBadge('');
    }
  };
  const rebase = () => {
    const c = current();
    if (!c) return;
    const ids = [...pts.current.keys()].slice(0, 2);
    base.current = ids.length ? { view: live.current ?? c.clip.view, a: pts.current.get(ids[0]!)!, b: ids[1] !== undefined ? pts.current.get(ids[1])! : null, ids } : null;
    const gm = groupMembers();
    groupBase.current = gm.length ? gm.map((i) => ({ i, v: groupLive.current?.find(([j]) => j === i)?.[1] ?? getState().project.clips[i]!.view })) : null;
    arm.current = new Map(pts.current);
    if (!editRegion.current && getState().handles && getState().multi.length === 0 && c.media.solid === undefined && c.media.kind !== 'audio') {
      const k = inkCrop(c.clip, c.media) ?? { l: 0, t: 0, r: 0, b: 0 };
      const { boxW: W, boxH: H } = sizes.current;
      const sc = baseScale(c.media.width, c.media.height, W, H) * c.clip.view.zoom;
      const pw = c.media.width * sc;
      const ph = c.media.height * sc;
      const lx = ((k.l - k.r) / 2) * pw;
      const ly = ((k.t - k.b) / 2) * ph;
      const a = (c.clip.view.rot * Math.PI) / 180;
      editRegion.current = {
        cx: W / 2 + c.clip.view.x * W + lx * Math.cos(a) - ly * Math.sin(a),
        cy: H / 2 + c.clip.view.y * H + lx * Math.sin(a) + ly * Math.cos(a),
        hw: (pw * (1 - k.l - k.r)) / 2,
        hh: (ph * (1 - k.t - k.b)) / 2,
      };
    }
  };
  /** (re)starts the hold timer: still fingers for this long switch to fine control from where they are */
  const startTimer = () => {
    clearTimeout(timer.current);
    if (tap.current?.moved) return; // once the finger has dragged, fine control is off for this touch
    arm.current = new Map(pts.current);
    timer.current = window.setTimeout(() => {
      if (pts.current.size === 0 || fine.current) return;
      rebase();
      setFineLook(true);
      haptic(14);
    }, HOLD_MS);
  };
  const paint = () => {
    frame.current = 0;
    engine.draw();
  };
  /** ends everything: saves the picture where it is and forgets all fingers */
  const flush = () => {
    if (band.current) {
      band.current = null;
      paintBand();
      releaseHud();
    }
    clearTimeout(timer.current);
    pts.current.clear();
    arm.current.clear();
    clearTimeout(holdTimer.current);
    base.current = null;
    guides(null);
    lines(null, null);
    setFineLook(false);
    groupBase.current = null;
    if (groupLive.current) {
      const out = groupLive.current;
      groupLive.current = null;
      engine.liveMany = null;
      setViews(out);
      pingGroup();
      engine.draw();
      live.current = null; // the group moved the strips: the single-strip view that was remembered at touch-down must not be written back
    }
    const v = live.current;
    live.current = null;
    const armed = snapT.current;
    clearTimeout(zoneTimer.current);
    zone.current = null;
    snapT.current = null;
    if (ghostEl.current) ghostEl.current.style.display = 'none';
    const ec = editCrop.current;
    editCrop.current = null;
    editRegion.current = null;
    if (ec && v) {
      const c = current();
      const inset = c?.media.textBox ?? { l: 0, t: 0, r: 0, b: 0 };
      const z = (n: number, i: number) => (n <= i + 1e-6 ? 0 : n);
      const k = { l: z(ec.l, inset.l), t: z(ec.t, inset.t), r: z(ec.r, inset.r), b: z(ec.b, inset.b) };
      engine.cropLive = null;
      engine.ghost = false;
      engine.live = null;
      updateClip(getState().selected, { view: v, crop: k.l || k.t || k.r || k.b ? k : undefined });
      engine.draw();
      releaseHud();
      return;
    }
    if (armed && v) return void snapNow(armed, v);
    if (v && v !== getState().project.clips[getState().selected]?.view) {
      updateClip(getState().selected, { view: v });
      engine.live = null;
      engine.draw();
    }
  };
  /** the picture goes to fill half or a quarter of the canvas (cropped to it), sliding there */
  const snapNow = (T: Rect, from: View) => {
    const c = current();
    if (!c) return;
    const { boxW: W, boxH: H } = sizes.current;
    const idx = getState().selected;
    const inset = c.media.solid === undefined ? c.media.textBox : undefined;
    const r = fitSegment(from, inkCrop(c.clip, c.media), inset, c.media.width, c.media.height, W, H, T, 'fill');
    const base = inset ?? { l: 0, t: 0, r: 0, b: 0 };
    const rc = r.crop ?? base;
    const plain = rc.l === base.l && rc.t === base.t && rc.r === base.r && rc.b === base.b;
    const c0: Crop = c.clip.crop ?? { l: 0, t: 0, r: 0, b: 0 };
    const c1: Crop = plain ? { l: 0, t: 0, r: 0, b: 0 } : rc;
    const dRot = normAngle(r.view.rot - from.rot);
    const t0 = performance.now();
    const T_MS = 260;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / T_MS);
      const e = 1 - Math.pow(1 - k, 3);
      const lerp = (a: number, b: number) => a + (b - a) * e;
      engine.live = { index: idx, view: { x: lerp(from.x, r.view.x), y: lerp(from.y, r.view.y), zoom: lerp(from.zoom, r.view.zoom), rot: from.rot + dRot * e } };
      engine.cropLive = { index: idx, crop: { l: lerp(c0.l, c1.l), t: lerp(c0.t, c1.t), r: lerp(c0.r, c1.r), b: lerp(c0.b, c1.b) } };
      engine.draw();
      if (k < 1) return void requestAnimationFrame(tick);
      engine.live = null;
      engine.cropLive = null;
      updateClip(idx, { view: r.view, crop: plain ? undefined : rc });
      engine.draw();
      say(`${T.w < W - 0.5 && T.h < H - 0.5 ? 'Quarter' : 'Half'} · fill`);
    };
    requestAnimationFrame(tick);
  };

  useEffect(() => {
    adoptFingers = adopt;
    return () => {
      adoptFingers = null;
      window.removeEventListener('pointermove', move);
    };
  }, []);

  useEffect(() => {
    // safety nets: the element's own events are enough on a good day
    const lost = (e: PointerEvent) => {
      if (!pts.current.has(e.pointerId)) return;
      pts.current.delete(e.pointerId);
      if (pts.current.size === 0) flush();
      else (rebase(), startTimer());
    };
    const touchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0 && pts.current.size > 0) flush();
    };
    const hide = () => flush();
    window.addEventListener('pointerup', lost);
    window.addEventListener('pointercancel', lost);
    window.addEventListener('touchend', touchEnd);
    window.addEventListener('touchcancel', touchEnd);
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('pointerup', lost);
      window.removeEventListener('pointercancel', lost);
      window.removeEventListener('touchend', touchEnd);
      window.removeEventListener('touchcancel', touchEnd);
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', hide);
      flush();
    };
  }, []);

  const rel = (e: PointerEvent): Pt => {
    return relClient(e.clientX, e.clientY);
  };
  const relClient = (cx: number, cy: number): Pt => {
    const r = (root.current ?? document.body).getBoundingClientRect();
    const p = localPoint(r, cx, cy);
    return { x: p.x - sizes.current.boxW / 2, y: p.y - sizes.current.boxH / 2 };
  };
  /** every visible picture under a point (client coordinates), front-most first */
  const hitsAt = (cx: number, cy: number): number[] => {
    const out: number[] = [];
    const st0 = getState();
    const visible = activeAt(st0.project.clips, st0.playhead);
    const q = relClient(cx, cy);
    const { boxW: W, boxH: H } = sizes.current;
    for (const i of [...visible].reverse()) {
      const c = st0.project.clips[i]!;
      const m = st0.project.media[c.mediaId];
      if (!m || m.kind === 'audio') continue;
      const inset = m.textBox ?? { l: 0, t: 0, r: 0, b: 0 };
      const cr = c.crop ?? { l: 0, t: 0, r: 0, b: 0 };
      const k = m.solid !== undefined ? cr : { l: Math.max(cr.l, inset.l), t: Math.max(cr.t, inset.t), r: Math.max(cr.r, inset.r), b: Math.max(cr.b, inset.b) };
      const sc = baseScale(m.width, m.height, W, H) * c.view.zoom;
      const a = (c.view.rot * Math.PI) / 180;
      const dx = q.x - c.view.x * W;
      const dy = q.y - c.view.y * H;
      const lx = dx * Math.cos(a) + dy * Math.sin(a);
      const ly = -dx * Math.sin(a) + dy * Math.cos(a);
      const pw = m.width * sc;
      const ph = m.height * sc;
      if (lx >= -pw / 2 + k.l * pw && lx <= pw / 2 - k.r * pw && ly >= -ph / 2 + k.t * ph && ly <= ph / 2 - k.b * ph) out.push(i);
    }
    return out;
  };
  /** the top-most visible strip under a point, or -1 for empty canvas */
  const hitAt = (cx: number, cy: number): number => hitsAt(cx, cy)[0] ?? -1;
  /** a tap on the picture: a strip under the finger is selected (or, in multi-selection, added or taken out); empty canvas selects nothing */
  const pickAt = (cx: number, cy: number) => {
    const st0 = getState();
    const i = hitAt(cx, cy);
    if (i < 0) return deselect();
    if (st0.multi.length > 0) return toggleMulti(i);
    if (i !== st0.selected) return selectClip(i, { keepPlayhead: true });
    // tapping the picked picture again does nothing: select mode and edit mode are switched with the button in the middle bar
  };
  /** a finger held still on empty canvas or on a strip that is not the picked one starts (or grows) a multi-selection */
  const holdPick = (cx: number, cy: number, selBefore: number) => {
    const st = getState();
    const i = hitAt(cx, cy);
    const idOf = (k: number) => st.project.clips[k]?.id;
    const ids = new Set(st.multi.length > 0 ? st.multi : selBefore >= 0 && idOf(selBefore) ? [idOf(selBefore)!] : []);
    if (i >= 0) ids.add(idOf(i)!);
    if (ids.size === 0) return;
    setMulti([...ids]);
    try {
      haptic(12);
    } catch {
      /* not supported */
    }
  };
  /** the rubber band of a box selection (hold, then drag): corners in canvas-relative points */
  const holdFrom = useRef(-1);
  const band = useRef<{ a: Pt; b: Pt } | null>(null);
  const bandEl = useRef<HTMLDivElement>(null);
  const paintBand = () => {
    const el = bandEl.current;
    const bd = band.current;
    if (!el) return;
    if (!bd) return void (el.style.display = 'none');
    const { boxW: W, boxH: H } = sizes.current;
    el.style.display = 'block';
    el.style.left = `${Math.min(bd.a.x, bd.b.x) + W / 2}px`;
    el.style.top = `${Math.min(bd.a.y, bd.b.y) + H / 2}px`;
    el.style.width = `${Math.abs(bd.a.x - bd.b.x)}px`;
    el.style.height = `${Math.abs(bd.a.y - bd.b.y)}px`;
  };
  /** every strip on screen whose picture the band touches */
  const bandPick = () => {
    const bd = band.current;
    const st = getState();
    if (!bd) return [] as string[];
    const bx0 = Math.min(bd.a.x, bd.b.x);
    const bx1 = Math.max(bd.a.x, bd.b.x);
    const by0 = Math.min(bd.a.y, bd.b.y);
    const by1 = Math.max(bd.a.y, bd.b.y);
    const { boxW: W, boxH: H } = sizes.current;
    const out: string[] = [];
    for (const i of activeAt(st.project.clips, st.playhead)) {
      const c = st.project.clips[i]!;
      const m = st.project.media[c.mediaId];
      if (!m || m.kind === 'audio') continue;
      // what counts is the part that shows (cropped, letters only for a text), not the whole picture behind it
      const r = shownBox(c.view, inkCrop(c, m), m.width, m.height, W, H);
      const x0 = r.x - W / 2;
      const y0 = r.y - H / 2;
      if (x0 + r.w >= bx0 && x0 <= bx1 && y0 + r.h >= by0 && y0 <= by1) out.push(c.id);
    }
    return out;
  };
  const lastEv = useRef<Event | null>(null);
  const winMove = useRef(false);
  /** The transform box saw a second finger: both fingers now belong to the picture (pinch), wherever they landed. */
  const adopt = (list: { id: number; x: number; y: number }[]) => {
    const c = current();
    if (!c) return;
    engine.pause();
    for (const f of list.slice(0, 2)) pts.current.set(f.id, relClient(f.x, f.y));
    if (tap.current) tap.current.multi = true;
    else tap.current = { t: performance.now(), x: list[0]!.x, y: list[0]!.y, moved: true, multi: true };
    if (!live.current) live.current = c.clip.view;
    rebase();
    startTimer();
    if (!winMove.current) {
      winMove.current = true;
      window.addEventListener('pointermove', move);
    }
  };

  const down = (e: PointerEvent) => {
    e.preventDefault();
    // the first finger of a gesture: anything still remembered from before is a lost finger
    if (e.isPrimary && pts.current.size > 0) flush();
    // work on the clip that is on screen (playback may have moved on from the selected one)
    const st0 = getState();
    const selBefore = st0.selected;
    const visible = activeAt(st0.project.clips, st0.playhead);
    if (selBefore >= 0 && !visible.includes(getState().selected)) {
      const shown = engine.currentIndex();
      if (shown >= 0) set({ selected: shown });
    }
    engine.pause();
    // nothing is selected: the picture under the finger is picked, and it is the one that moves (a tap that only selects is not a mode swap)
    autoPicked.current = false;
    if (e.isPrimary && selBefore < 0 && st0.multi.length === 0) {
      const h0 = hitAt(e.clientX, e.clientY);
      if (h0 >= 0) {
        selectClip(h0, { keepPlayhead: true });
        autoPicked.current = true;
      }
    }
    // something else is selected: one picture under the finger takes over the selection; with several stacked there,
    // the selected one keeps it when it is one of them (even if it is not in front), otherwise the front one is taken
    else if (e.isPrimary && selBefore >= 0 && st0.multi.length === 0) {
      const hits = hitsAt(e.clientX, e.clientY);
      const pick = hits.length === 0 || hits.includes(getState().selected) ? -1 : hits[0]!;
      if (pick >= 0) {
        selectClip(pick, { keepPlayhead: true });
        autoPicked.current = true;
      }
    }
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    pts.current.set(e.pointerId, rel(e));
    if (pts.current.size > 1) {
      if (tap.current) tap.current.multi = true;
    } else tap.current = { t: performance.now(), x: e.clientX, y: e.clientY, moved: false, multi: false };
    const c = current();
    if (c && !live.current) live.current = c.clip.view;
    rebase();
    startTimer();
    // holding on the picked picture is fine control (above). Holding on empty canvas or on another picture picks it too
    clearTimeout(holdTimer.current);
    if (pts.current.size === 1) {
      const hit = hitAt(e.clientX, e.clientY);
      const cs = st0.project.clips;
      const active = st0.multi.length > 0 ? hit >= 0 && st0.multi.includes(cs[hit]!.id) : hit >= 0 && hit === selBefore;
      if (!active) {
        const x = e.clientX;
        const y = e.clientY;
        holdTimer.current = window.setTimeout(() => {
          if (pts.current.size !== 1 || fine.current || tap.current?.moved) return;
          clearTimeout(timer.current);
          if (tap.current) tap.current.multi = true; // this touch was a hold, not a tap
          const p = relClient(x, y);
          band.current = { a: p, b: p };
          hold('Box select');
          holdFrom.current = selBefore;
          paintBand();
          try {
            haptic(12);
          } catch {
            /* not supported */
          }
        }, MULTI_HOLD_MS);
      }
    }
  };
  const move = (e: PointerEvent) => {
    if (lastEv.current === e) return; // the same event reaches the layer and the window
    lastEv.current = e;
    if (!pts.current.has(e.pointerId)) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) return flush(); // button released somewhere we did not see
    pts.current.set(e.pointerId, rel(e));
    if (band.current) {
      band.current.b = rel(e);
      return void paintBand();
    }
    const tp = tap.current;
    if (tp && Math.hypot(e.clientX - tp.x, e.clientY - tp.y) > JITTER) (tp.moved = true), clearTimeout(holdTimer.current);
    const b = base.current;
    const c = current();
    if (!b || !c) return;
    if (!fine.current) {
      // any finger moving more than a wobble restarts the hold timer
      for (const [id, p] of pts.current) {
        const q = arm.current.get(id);
        if (!q || Math.hypot(p.x - q.x, p.y - q.y) > JITTER) return void (clearTimeout(timer.current), step(b, c));
      }
    }
    step(b, c);
  };
  /** one or two fingers moving, scaling and turning every picked strip on screen around the same point */
  const stepGroup = (b: NonNullable<typeof base.current>, members: { i: number; v: View }[]) => {
    const { boxW: W, boxH: H } = sizes.current;
    const raw1 = pts.current.get(b.ids[0]!);
    const raw2 = b.b ? pts.current.get(b.ids[1]!) : undefined;
    if (!raw1 || (b.b && !raw2)) return;
    const f = (p: Pt, q: Pt): Pt => (fine.current ? { x: q.x + (p.x - q.x) * FINE, y: q.y + (p.y - q.y) * FINE } : p);
    const a1 = f(raw1, b.a);
    let m0: Pt = b.a;
    let m1: Pt = a1;
    let scale = 1;
    let dr = 0;
    if (b.b && raw2) {
      const b1 = f(raw2, b.b);
      m0 = { x: (b.a.x + b.b.x) / 2, y: (b.a.y + b.b.y) / 2 };
      m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
      scale = Math.max(0.05, Math.hypot(b1.x - a1.x, b1.y - a1.y) / (Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) || 1));
      dr = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b.b.y - b.a.y, b.b.x - b.a.x);
    }
    // every 45 degrees is a magnet for the group too (not in fine mode), with the same capsule as for one picture
    let snapped: number | null = null;
    if (b.b && !fine.current) {
      const r0 = members[0]!.v.rot;
      const target = r0 + (dr * 180) / Math.PI;
      const q = Math.round(target / 45) * 45;
      if (Math.abs(target - q) < 4) (dr = ((q - r0) * Math.PI) / 180), (snapped = normAngle(q));
    }
    if (!fine.current) showBadge(b.b && Math.abs(dr) > 0.0087 ? fmtDeg(normAngle(members[0]!.v.rot + (dr * 180) / Math.PI)) : snapped !== null ? fmtDeg(snapped) : '');
    const zs = members.map((m) => m.v.zoom);
    scale = Math.max(clampZoom(0) / Math.min(...zs), Math.min(scale, clampZoom(1e9) / Math.max(...zs)));
    const cos = Math.cos(dr);
    const sin = Math.sin(dr);
    const out: [number, View][] = members.map(({ i, v }) => {
      const dx = v.x * W - m0.x;
      const dy = v.y * H - m0.y;
      const nx = m1.x + scale * (dx * cos - dy * sin);
      const ny = m1.y + scale * (dx * sin + dy * cos);
      return [i, { x: nx / W, y: ny / H, zoom: clampZoom(v.zoom * scale), rot: normAngle(v.rot + (dr * 180) / Math.PI) }];
    });
    groupLive.current = out;
    engine.liveMany = new Map(out);
    pingGroup();
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };
  const step = (b: NonNullable<typeof base.current>, c: NonNullable<ReturnType<typeof current>>) => {
    if (groupBase.current) return stepGroup(b, groupBase.current);
    const { boxW: W, boxH: H } = sizes.current;
    const raw1 = pts.current.get(b.ids[0]!);
    const raw2 = b.b ? pts.current.get(b.ids[1]!) : undefined;
    if (!raw1 || (b.b && !raw2)) return;
    // in fine mode the fingers' movement counts a tenth
    const f = (p: Pt, q: Pt): Pt => (fine.current ? { x: q.x + (p.x - q.x) * FINE, y: q.y + (p.y - q.y) * FINE } : p);
    const a1 = f(raw1, b.a);
    let v: View;
    if (b.b && raw2) v = pinchView(b.view, W, H, b.a, b.b, a1, f(raw2, b.b));
    else v = dragView(b.view, W, H, a1.x - b.a.x, a1.y - b.a.y);
    const R = editRegion.current;
    if (R) {
      // edit mode: the frame stays, the picture moves and scales behind it (no turning), and the crop follows.
      // The picture always covers the frame: it can't shrink below it or slide off it.
      v = { ...v, rot: b.view.rot };
      const inset = c.media.textBox ?? { l: 0, t: 0, r: 0, b: 0 };
      const base0 = baseScale(c.media.width, c.media.height, W, H);
      const zmin = Math.max((2 * R.hw) / (c.media.width * base0 * Math.max(0.05, 1 - inset.l - inset.r)), (2 * R.hh) / (c.media.height * base0 * Math.max(0.05, 1 - inset.t - inset.b)));
      v = { ...v, zoom: Math.max(v.zoom, zmin) };
      // moving along one axis only: the position it started from pulls
      if (!b.b && !fine.current) {
        if (Math.abs(v.x - b.view.x) * W < 7) v = { ...v, x: b.view.x };
        if (Math.abs(v.y - b.view.y) * H < 7) v = { ...v, y: b.view.y };
      }
      const sc = base0 * v.zoom;
      const pw = c.media.width * sc;
      const ph = c.media.height * sc;
      const a = (v.rot * Math.PI) / 180;
      const dx = R.cx - (W / 2 + v.x * W);
      const dy = R.cy - (H / 2 + v.y * H);
      let lx = dx * Math.cos(a) + dy * Math.sin(a);
      let ly = -dx * Math.sin(a) + dy * Math.cos(a);
      const loX = R.hw - pw / 2 + inset.l * pw;
      const hiX = pw / 2 - inset.r * pw - R.hw;
      const loY = R.hh - ph / 2 + inset.t * ph;
      const hiY = ph / 2 - inset.b * ph - R.hh;
      // the edges of the picture pull the frame's sides
      const SN = fine.current ? 0 : 7;
      if (Math.abs(lx - loX) < SN) lx = loX;
      else if (Math.abs(lx - hiX) < SN) lx = hiX;
      if (Math.abs(ly - loY) < SN) ly = loY;
      else if (Math.abs(ly - hiY) < SN) ly = hiY;
      lx = Math.min(hiX, Math.max(loX, lx));
      ly = Math.min(hiY, Math.max(loY, ly));
      regionTick(!fine.current && (lx === loX || lx === hiX || ly === loY || ly === hiY) ? `${lx === loX ? 'l' : lx === hiX ? 'r' : ''}${ly === loY ? 't' : ly === hiY ? 'b' : ''}` : null);
      v = { ...v, x: (R.cx - (lx * Math.cos(a) - ly * Math.sin(a)) - W / 2) / W, y: (R.cy - (lx * Math.sin(a) + ly * Math.cos(a)) - H / 2) / H };
      const k: Crop = {
        l: Math.max(inset.l, (lx - R.hw + pw / 2) / pw),
        r: Math.max(inset.r, 1 - (lx + R.hw + pw / 2) / pw),
        t: Math.max(inset.t, (ly - R.hh + ph / 2) / ph),
        b: Math.max(inset.b, 1 - (ly + R.hh + ph / 2) / ph),
      };
      live.current = v;
      editCrop.current = k;
      engine.live = { index: getState().selected, view: v };
      engine.cropLive = { index: getState().selected, crop: k };
      engine.ghost = true;
      hold('Crop');
      if (!frame.current) frame.current = requestAnimationFrame(paint);
      return;
    }
    v = clampView(v, { sw: c.media.width, sh: c.media.height, W, H });
    if (fine.current) {
      live.current = v;
      engine.live = { index: getState().selected, view: v };
    } else {
      const env = { sw: c.media.width, sh: c.media.height, W, H };
      const ink = inkCrop(c.clip, c.media);
      const sn = snapViewCropped(v, env, ink);
      let nv = sn.view;
      // sides and middles of the other pictures (and the canvas middle lines for the picture's own sides) pull too
      let lineX: number | null = null;
      let lineY: number | null = null;
      if (!b.b) {
        const box = shownBox(nv, ink, c.media.width, c.media.height, W, H);
        const tg = targets([getState().selected]);
        const pull = (edges: number[], list: number[]) => {
          let best = 7;
          let hit: { d: number; at: number } | null = null;
          for (const e of edges) for (const t of list) if (Math.abs(t - e) < best) (best = Math.abs(t - e)), (hit = { d: t - e, at: t });
          return hit;
        };
        if (!sn.x && !sn.edges.l && !sn.edges.r) {
          const h = pull([box.x, box.x + box.w / 2, box.x + box.w], tg.xs);
          if (h) (nv = { ...nv, x: nv.x + h.d / W }), (lineX = h.at);
        }
        if (!sn.y && !sn.edges.t && !sn.edges.b) {
          const h = pull([box.y, box.y + box.h / 2, box.y + box.h], tg.ys);
          if (h) (nv = { ...nv, y: nv.y + h.d / H }), (lineY = h.at);
        }
      }
      live.current = nv;
      engine.live = { index: getState().selected, view: nv };
      guides(sn, !!b.b, b.b && Math.abs(normAngle(nv.rot - b.view.rot)) > 0.5 ? nv.rot : null);
      lines(lineX, lineY);
      // half / quarter snapping: the finger (not the picture) held at a side or corner of the canvas
      if (!b.b && raw1) {
        const px = raw1.x + W / 2;
        const py = raw1.y + H / 2;
        const ex = px < W * 0.1 ? -1 : px > W * 0.9 ? 1 : 0;
        const ey = py < H * 0.1 ? -1 : py > H * 0.9 ? 1 : 0;
        // a corner is a corner zone; a half needs the middle of a side, not anywhere along it
        const sx = ex !== 0 && (ey !== 0 || Math.abs(py - H / 2) < H * 0.17) ? ex : 0;
        const sy = ey !== 0 && (ex !== 0 || Math.abs(px - W / 2) < W * 0.17) ? ey : 0;
        const key = `${sx},${sy}`;
        const z = zone.current;
        const moved = z ? Math.hypot(px - z.x, py - z.y) > 14 : false;
        if (!z || z.key !== key || moved) {
          clearTimeout(zoneTimer.current);
          snapT.current = null;
          if (ghostEl.current) ghostEl.current.style.display = 'none';
          zone.current = { key, x: px, y: py };
          if (sx !== 0 || sy !== 0) {
            const T: Rect = { x: sx === 1 ? W / 2 : 0, y: sy === 1 ? H / 2 : 0, w: sx === 0 ? W : W / 2, h: sy === 0 ? H : H / 2 };
            zoneTimer.current = window.setTimeout(() => {
              snapT.current = T;
              const g = ghostEl.current;
              if (g) Object.assign(g.style, { display: 'block', left: `${T.x}px`, top: `${T.y}px`, width: `${T.w}px`, height: `${T.h}px` });
              try {
                haptic(10);
              } catch {
                /* not supported */
              }
              hold(T.w < W - 0.5 && T.h < H - 0.5 ? 'Quarter' : 'Half');
            }, 420);
          } else releaseHud();
        }
      }
    }
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };
  const lastUp = useRef({ x: 0, y: 0 });
  const up = (e: PointerEvent) => {
    lastUp.current = { x: e.clientX, y: e.clientY };
    if (!pts.current.delete(e.pointerId)) return;
    if (band.current && pts.current.size > 0) pts.current.clear();
    if (pts.current.size > 0) {
      // a finger lifted or was added: carry on from where the picture is now
      rebase();
      return;
    }
    if (band.current) {
      releaseHud();
      const bd = band.current;
      const small = Math.hypot(bd.a.x - bd.b.x, bd.a.y - bd.b.y) < 12;
      const ids = bandPick();
      band.current = null;
      paintBand();
      tap.current = null;
      flush();
      const st = getState();
      const keep = st.multi.length > 0 ? st.multi : holdFrom.current >= 0 && st.project.clips[holdFrom.current] ? [st.project.clips[holdFrom.current]!.id] : [];
      if (small) {
        // held and let go without dragging: the picture under the finger joins
        const mid = bd.a;
        const hit = hitAt(lastUp.current.x, lastUp.current.y);
        void mid;
        const all = new Set(keep);
        if (hit >= 0) all.add(st.project.clips[hit]!.id);
        if (all.size === 1) {
          const k1 = st.project.clips.findIndex((c) => c.id === [...all][0]);
          if (k1 >= 0) selectClip(k1, { keepPlayhead: true });
        } else if (all.size > 1) setMulti([...all]);
      } else if (ids.length > 0) {
        const all = [...new Set([...keep, ...ids])];
        // one picture is just selected; picking several starts multi-selection
        if (all.length === 1) {
          const k1 = st.project.clips.findIndex((c) => c.id === all[0]);
          if (k1 >= 0) selectClip(k1, { keepPlayhead: true });
        } else setMulti(all);
      }
      return;
    }
    const tp = tap.current;
    tap.current = null;
    flush();
    if (tp && !tp.moved && !tp.multi && performance.now() - tp.t < 300) {
      const lt = lastTap.current;
      if (lt && tp.t - lt.t < DOUBLE_MS + 60 && Math.hypot(tp.x - lt.x, tp.y - lt.y) < 40) {
        lastTap.current = null;
        clearTimeout(cropTimer.current);
        // a double tap works on what was selected before it: the first touch of the pair must not have switched the selection
        if (lt.prevMulti.length > 0) setMulti(lt.prevMulti);
        else if (getState().selected !== lt.prev || getState().multi.length > 0) (lt.prev >= 0 ? selectClip(lt.prev, { keepPlayhead: true }) : deselect());
        set({ handles: lt.prevHandles });
        doubleTap(lt.x, lt.y);
      } else {
        const prev = getState().selected;
        const prevMulti = getState().multi;
        const prevHandles = getState().handles;
        if (autoPicked.current) {
          // this touch already picked the picture on touch-down: it must not also swap select and edit mode
          // a double tap then works on that picture (it stays picked), in select mode
          lastTap.current = { t: tp.t, x: tp.x, y: tp.y, prev: getState().selected, prevMulti: [], prevHandles: false };
          autoPicked.current = false;
          return;
        }
        pickAt(tp.x, tp.y);
        lastTap.current = { t: tp.t, x: tp.x, y: tp.y, prev, prevMulti, prevHandles };
      }
    }
  };
  /** snaps to the closest of the eight tidy placements (quarter turn x fit/fill); again flips fit/fill */
  /** the pictures slide from where they are to their new placement (same easing as a half or quarter placement), then the change is stored */
  const glide = (moves: [number, View, View][], done: () => void) => {
    const t0 = performance.now();
    const T_MS = 260;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / T_MS);
      const e = 1 - Math.pow(1 - k, 3);
      engine.liveMany = new Map(moves.map(([i, a, b]) => [i, { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, zoom: a.zoom + (b.zoom - a.zoom) * e, rot: a.rot + normAngle(b.rot - a.rot) * e }]));
      engine.draw();
      if (k < 1) return void requestAnimationFrame(tick);
      engine.liveMany = null;
      done();
      engine.draw();
    };
    requestAnimationFrame(tick);
  };
  /** several strips picked: the whole composition (the box around all of them) is fitted into the canvas or made to fill it, as one piece */
  const doubleTapGroup = (members: number[], T: { x: number; y: number; w: number; h: number }) => {
    const st = getState();
    const { boxW: W, boxH: H } = sizes.current;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const info: { i: number; v: View }[] = [];
    for (const i of members) {
      const clip = st.project.clips[i]!;
      const m = st.project.media[clip.mediaId]!;
      const v = clip.view;
      const inset = m.textBox;
      const cr = clip.crop;
      const crop = m.solid !== undefined || !inset ? (cr ?? { l: 0, t: 0, r: 0, b: 0 }) : { l: Math.max(cr?.l ?? 0, inset.l), t: Math.max(cr?.t ?? 0, inset.t), r: Math.max(cr?.r ?? 0, inset.r), b: Math.max(cr?.b ?? 0, inset.b) };
      const sc = baseScale(m.width, m.height, W, H) * v.zoom;
      const pw = m.width * sc;
      const ph = m.height * sc;
      const a = (v.rot * Math.PI) / 180;
      const cx = W / 2 + v.x * W;
      const cy = H / 2 + v.y * H;
      for (const [lx, ly] of [
        [-pw / 2 + crop.l * pw, -ph / 2 + crop.t * ph],
        [pw / 2 - crop.r * pw, -ph / 2 + crop.t * ph],
        [pw / 2 - crop.r * pw, ph / 2 - crop.b * ph],
        [-pw / 2 + crop.l * pw, ph / 2 - crop.b * ph],
      ] as [number, number][]) {
        const px = cx + lx * Math.cos(a) - ly * Math.sin(a);
        const py = cy + lx * Math.sin(a) + ly * Math.cos(a);
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
      info.push({ i, v });
    }
    const w = x1 - x0;
    const h = y1 - y0;
    if (!(w > 1) || !(h > 1)) return;
    // as with one strip: where the tap landed decides what the group fits into (a quarter, a half or all of the canvas)
    const sFit = Math.min(T.w / w, T.h / h);
    const sFill = Math.max(T.w / w, T.h / h);
    const tcx = T.x + T.w / 2;
    const tcy = T.y + T.h / 2;
    const fitted = Math.abs(sFit - 1) < 0.02 && Math.abs(x0 + w / 2 - tcx) < 2 && Math.abs(y0 + h / 2 - tcy) < 2;
    const s = fitted && sFill / sFit > 1.02 ? sFill : sFit;
    const ux = x0 + w / 2;
    const uy = y0 + h / 2;
    const out: [number, View][] = info.map(({ i, v }) => {
      const cx = W / 2 + v.x * W;
      const cy = H / 2 + v.y * H;
      const nx = tcx + s * (cx - ux);
      const ny = tcy + s * (cy - uy);
      return [i, { ...v, x: (nx - W / 2) / W, y: (ny - H / 2) / H, zoom: v.zoom * s }];
    });
    glide(out.map(([i, v]) => [i, st.project.clips[i]!.view, v] as [number, View, View]), () => setViews(out));
    showBadge(s === sFit ? 'Fit' : 'Fill');
    window.setTimeout(() => !fine.current && showBadge(''), 700);
  };
  const doubleTap = (cx: number, cy: number) => {
    void cx;
    void cy;
    hapticDouble();
    const members = groupMembers();
    const { boxW: W, boxH: H } = sizes.current;
    // the whole canvas: fit, fill, and the quarter turns (half and quarter placements come from dragging to a side or corner)
    const target: Rect = { x: 0, y: 0, w: W, h: H };
    if (members.length > 1) return doubleTapGroup(members, target);
    const st = getState();
    const i = st.selected;
    const clip = st.project.clips[i];
    const media = clip && st.project.media[clip.mediaId];
    if (!clip || !media || media.kind === 'audio') return;
    if (st.handles) {
      // edit mode: a double tap gives the cut-off parts back and puts the picture at its start position
      resetTransform(i);
      say('Reset');
      return;
    }
    // the box a person sees hugs the letters of a text, so fit and fill use that box, not the whole picture with its margins
    const inset = media.textBox;
    const sc = clip.crop;
    const crop = media.solid !== undefined || !inset ? sc : { l: Math.max(sc?.l ?? 0, inset.l), t: Math.max(sc?.t ?? 0, inset.t), r: Math.max(sc?.r ?? 0, inset.r), b: Math.max(sc?.b ?? 0, inset.b) };
    const v = clampView(snapEightCropped(clip.view, crop, media.width, media.height, W, H), { sw: media.width, sh: media.height, W, H });
    glide([[i, clip.view, v]], () => updateClip(i, { view: v }));
    const cw = media.width * (1 - (crop?.l ?? 0) - (crop?.r ?? 0));
    const ch = media.height * (1 - (crop?.t ?? 0) - (crop?.b ?? 0));
    const k = baseScale(cw, ch, W, H) / baseScale(media.width, media.height, W, H);
    const fit = fitZoom(cw, ch, v.rot, W, H) * k;
    showBadge(Math.abs(v.zoom - fit) / fit < 0.02 ? 'Fit' : 'Fill');
    window.setTimeout(() => !fine.current && showBadge(''), 700);
  };
  useEffect(() => {
    handleDouble = () => doubleTap(0, 0);
    handleSingle = null;
    return () => {
      handleDouble = null;
      handleSingle = null;
    };
  });
  const wheel = (e: WheelEvent) => {
    // desktop: scroll to zoom
    const c = current();
    if (!c) return;
    e.preventDefault();
    const z = c.clip.view.zoom * Math.exp(-e.deltaY / 500);
    const s = snapViewCropped(clampView({ ...c.clip.view, zoom: z }, { sw: c.media.width, sh: c.media.height, W: boxW, H: boxH }), { sw: c.media.width, sh: c.media.height, W: boxW, H: boxH }, inkCrop(c.clip, c.media));
    updateClip(getState().selected, { view: s.view });
  };

  return (
    <>
    {/* the whole preview area around the canvas takes the same touches (a box selection can start out there) */}
    <div class="gestures-around" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} />
    <div class="gestures" ref={root} key={selected} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
      <div class="guide v" ref={guideV} />
      <div class="guide h" ref={guideH} />
      {(['l', 'r', 't', 'b'] as const).map((k) => (
        <div key={k} class={`guide edge-${k}`} ref={(el) => void (edgeEls.current[k] = el)} />
      ))}
      <div class="rubber" ref={bandEl} />
      <div class="snap-ghost" ref={ghostEl} />
      <div class="guide gx" ref={gx} />
      <div class="guide gy" ref={gy} />
      <div class="gesture-badge num" ref={badge} />
    </div>
    </>
  );
}

/** the part of a picture that is really there: its crop, and for a text the letters without the empty margin around them */
function inkCrop(clip: Clip0, media: { textBox?: Crop; solid?: string }): Crop | undefined {
  const c = clip.crop;
  const i = media.solid === undefined ? media.textBox : undefined;
  if (!i) return c;
  return { l: Math.max(c?.l ?? 0, i.l), t: Math.max(c?.t ?? 0, i.t), r: Math.max(c?.r ?? 0, i.r), b: Math.max(c?.b ?? 0, i.b) };
}

/** the capsule on the preview while a handle is turned: the angle when it sits on a 45 degree step */
const turnTick = snapTicker();
const lineTick = snapTicker();
function turnBadge(frame: HTMLElement | null | undefined, deg: number | null): void {
  turnTick(deg);
  if (deg === null) hide();
  else say(fmtDeg(deg), 900);
}

/** sides and middles of every picture on screen except `skip`, plus the canvas edges and middle lines, in canvas pixels */
function boxTargets(W: number, H: number, skip: number[]): { xs: number[]; ys: number[] } {
  const st = getState();
  const xs = [0, W / 2, W];
  const ys = [0, H / 2, H];
  for (const i of activeAt(st.project.clips, st.playhead)) {
    if (skip.includes(i)) continue;
    const c = st.project.clips[i]!;
    const m = st.project.media[c.mediaId];
    if (!m || m.kind === 'audio') continue;
    const r = shownBox(c.view, inkCrop(c, m), m.width, m.height, W, H);
    xs.push(r.x, r.x + r.w / 2, r.x + r.w);
    ys.push(r.y, r.y + r.h / 2, r.y + r.h);
  }
  return { xs, ys };
}
/** shows snap lines on the preview (canvas pixels), or hides them */
function showLines(frame: HTMLElement | null | undefined, x: number | null, y: number | null): void {
  lineTick(x !== null || y !== null ? `${x},${y}` : null);
  const a = frame?.querySelector('.guide.gx') as HTMLElement | null;
  const b = frame?.querySelector('.guide.gy') as HTMLElement | null;
  if (a) (a.style.left = `${x ?? 0}px`), a.classList.toggle('on', x !== null);
  if (b) (b.style.top = `${y ?? 0}px`), b.classList.toggle('on', y !== null);
}

/** a double tap on a transform handle does what a double tap on the picture does (the picture may be too small to hit) */
let handleDouble: (() => void) | null = null;
let handleSingle: (() => void) | null = null;
let lastHandleTap = 0;
function handleTapped(): void {
  const now = performance.now();
  if (now - lastHandleTap < 400) {
    lastHandleTap = 0;
    handleDouble?.();
  } else {
    lastHandleTap = now;
    handleSingle?.();
  }
}

type Handle = 'tl' | 'tr' | 'br' | 'bl' | 'l' | 't' | 'r' | 'b' | 'rot';

/** fingers on the screen right now (any element), and whether one of them is on the transform box */
const fingers = new Set<number>();
/** fingers down anywhere right now: the transform box mounts after a touch that picked the picture, and must know a finger is already on it */
const fingerAt = new Map<number, { x: number; y: number }>();
let adoptFingers: ((list: { id: number; x: number; y: number }[]) => void) | null = null;
let onBox = 0;
/** the box that is on screen right now (if any) hears about fingers through these */
let boxCancel: (() => void) | null = null;
let boxQuiet: ((v: boolean) => void) | null = null;
/** the handles are hidden while a finger works on the picture (or two fingers are down) */
const quietNow = () => fingers.size >= 2 || (fingers.size === 1 && !onBox);
// The fingers are followed here, for good, and not by the box itself: the box is gone while nothing is selected, and a finger that
// lifted in that time was never seen, which left the next box (picked with a tap on the picture) without its handles.
if (typeof window !== 'undefined') {
  const down = (e: PointerEvent) => {
    // the first finger of a new touch: anything still remembered from before was lost
    if (e.isPrimary) (fingers.clear(), fingerAt.clear(), (onBox = 0));
    fingers.add(e.pointerId);
    fingerAt.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = e.target as Element | null;
    const mine = !!el?.closest?.('.tbox-h');
    if (mine) onBox = e.pointerId;
    // anything outside the preview (timeline, tabs, header...) puts the box away
    if (!el?.closest?.('.frame') && getState().boxMode) set({ boxMode: false });
    if (fingers.size >= 2 || !mine) boxCancel?.();
    // two fingers on the preview always mean pinch, even when the first one is already on a handle
    if (fingers.size >= 2 && el?.closest?.('.frame')) adoptFingers?.([...fingerAt].map(([id, p]) => ({ id, x: p.x, y: p.y })));
    boxQuiet?.(fingers.size >= 2 || !mine);
  };
  const track = (e: PointerEvent) => {
    if (fingerAt.has(e.pointerId)) fingerAt.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const up = (e: PointerEvent) => {
    fingers.delete(e.pointerId);
    fingerAt.delete(e.pointerId);
    if (onBox === e.pointerId) onBox = 0;
    boxQuiet?.(quietNow());
  };
  // fingers that are certainly gone (a lost pointerup): the handles must come back
  const reset = () => {
    if (fingers.size === 0 && !onBox) return;
    fingers.clear();
    fingerAt.clear();
    onBox = 0;
    boxQuiet?.(false);
  };
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', track, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('touchend', (e) => e.touches.length === 0 && void window.setTimeout(reset, 30), true);
  window.addEventListener('touchcancel', (e) => e.touches.length === 0 && void window.setTimeout(reset, 30), true);
  window.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && e.buttons === 0 && reset(), true);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => document.hidden && reset());
}

/**
 * The transform box of the selected clip: corners scale, the round handle on top turns, the sides crop.
 * It is an alternative to the finger gestures, not a replacement. It hides as soon as a second finger
 * touches the screen or a finger starts a gesture on the picture, and a second finger cancels a handle
 * that is being dragged, so the two ways never fight. The box may reach outside the canvas.
 */
function TransformBox({ boxW: W, boxH: H }: { boxW: number; boxH: number }) {
  const on = useStore((s) => s.multi.length === 0); // the box is simply there whenever one strip is selected
  const editing = useStore((s) => s.handles); // select mode: every handle scales; edit mode: the handles crop
  const selected = useStore((s) => s.selected);
  const clip = useStore((s) => s.project.clips[s.selected]);
  const media = useStore((s) => (s.project.clips[s.selected] ? s.project.media[s.project.clips[s.selected]!.mediaId] : undefined));
  const [drag, setDrag] = useState<{ view: View; crop: Crop } | null>(null);
  const [quiet, setQuiet] = useState(quietNow());
  // while fingers work on the picture the outline stays and follows it; only the handles step aside
  const [liveV, setLiveV] = useState<View | null>(null);
  const [liveC, setLiveC] = useState<Crop | null>(null);
  useEffect(() => {
    if (!quiet) return void (setLiveV(null), setLiveC(null));
    let raf = 0;
    const tick = () => {
      const l = engine.live;
      setLiveV(l && l.index === getState().selected ? l.view : null);
      const cl = engine.cropLive;
      setLiveC(cl && cl.index === getState().selected ? cl.crop : null);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [quiet]);
  const dragFrame = useRef(0);
  const dragLast = useRef<{ view: View; crop: Crop } | null>(null);
  const st = useRef<{ id: number; h: Handle; p0: Pt; raw0: Pt; off: Pt; moved: boolean; view0: View; crop0: Crop; last: Pt; anchor: Pt; fineRaw: Pt; fineEff: Pt; fine: boolean; timer: number; frame: HTMLElement | null; edit: boolean } | null>(null);

  const endFine = () => {
    const d = st.current;
    if (!d) return;
    clearTimeout(d.timer);
    d.frame?.classList.remove('fine');
    hudEndFine();
  };
  const cancel = () => {
    if (!st.current) return;
    cancelAnimationFrame(dragFrame.current);
    dragFrame.current = 0;
    dragLast.current = null;
    endFine();
    st.current = null;
    setDrag(null);
    engine.live = null;
    engine.cropLive = null;
    engine.ghost = false;
    engine.draw();
  };

  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    boxCancel = () => cancelRef.current();
    boxQuiet = setQuiet;
    setQuiet(quietNow()); // fingers that are down right now (the touch that picked this picture) are already counted
    return () => {
      boxCancel = null;
      boxQuiet = null;
    };
  }, []);

  // a different clip was selected: forget a drag in progress
  useEffect(cancel, [selected]);

  if (!on || !clip || !media || media.kind === 'audio') return null;
  const view = drag?.view ?? (quiet ? liveV : null) ?? clip.view;
  // text: the box hugs the letters, so each side starts where the ink starts
  const inset: Crop = media.textBox ?? { l: 0, t: 0, r: 0, b: 0 };
  const stored: Crop = drag?.crop ?? (quiet ? liveC : null) ?? clip.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const stretch = media.solid !== undefined; // a flat color has nothing to cut: its sides stretch it instead
  const crop: Crop = stretch ? stored : { l: Math.max(stored.l, inset.l), t: Math.max(stored.t, inset.t), r: Math.max(stored.r, inset.r), b: Math.max(stored.b, inset.b) };
  const sc = baseScale(media.width, media.height, W, H) * view.zoom;
  const pw = media.width * sc;
  const ph = media.height * sc;
  const a = (view.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = W / 2 + view.x * W;
  const cy = H / 2 + view.y * H;
  const at = (lx: number, ly: number): Pt => ({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
  const x0 = -pw / 2 + crop.l * pw;
  const x1 = pw / 2 - crop.r * pw;
  const y0 = -ph / 2 + crop.t * ph;
  const y1 = ph / 2 - crop.b * ph;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  const pos: Record<Handle, Pt> = {
    tl: at(x0, y0),
    tr: at(x1, y0),
    br: at(x1, y1),
    bl: at(x0, y1),
    l: at(x0, ym),
    r: at(x1, ym),
    t: at(xm, y0),
    b: at(xm, y1),
    rot: at(xm, y0 - 34),
  };

  const frameBox = (e: PointerEvent): Pt => {
    return localPoint((e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect(), e.clientX, e.clientY);
  };
  const down = (h: Handle) => (e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (fingers.size > 1) return; // a second finger is on the screen: the box does nothing
    engine.pause();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone */
    }
    // the handle itself counts as the touch point (no jump to where the finger landed on its hitbox), and nothing moves until the finger has travelled a few pixels
    const raw0 = frameBox(e);
    const p0 = { x: pos[h].x, y: pos[h].y };
    const off = { x: p0.x - raw0.x, y: p0.y - raw0.y };
    const frameEl = (e.currentTarget as HTMLElement).parentElement;
    const d = { id: e.pointerId, h, p0, raw0, off, moved: false, view0: clip.view, crop0: crop, last: p0, anchor: p0, fineRaw: p0, fineEff: p0, fine: false, timer: 0, frame: frameEl, edit: editing };
    st.current = d;
    // hold still on a handle and it moves ten times slower, for exact work
    const arm = () => {
      clearTimeout(d.timer);
      d.timer = window.setTimeout(() => {
        if (st.current !== d || d.fine) return;
        d.fine = true;
        d.fineRaw = d.last;
        d.fineEff = d.last;
        d.frame?.classList.add('fine');
        startFine();
        haptic(14);
      }, HOLD_MS);
    };
    (d as { arm?: () => void }).arm = arm;
    if (h !== 'rot') arm(); // the rotor keeps the plain two-finger way
    void stretch;
  };

  /** where the finger counts as being: its real place, or (in fine control) a tenth of the way from where it started */
  const point = (e: PointerEvent): Pt => {
    const d = st.current!;
    const rawF = frameBox(e);
    const raw = { x: rawF.x + d.off.x, y: rawF.y + d.off.y };
    d.last = raw;
    if (!d.fine && !d.moved) {
      if (Math.hypot(rawF.x - d.raw0.x, rawF.y - d.raw0.y) < 6) return d.p0;
      d.moved = true;
    }
    if (d.fine) return { x: d.fineEff.x + (raw.x - d.fineRaw.x) * 0.1, y: d.fineEff.y + (raw.y - d.fineRaw.y) * 0.1 };
    if (Math.hypot(raw.x - d.anchor.x, raw.y - d.anchor.y) > 10) {
      d.anchor = raw;
      clearTimeout(d.timer); // dragging ends the chance of fine control: it only starts from a hold
    }
    return raw;
  };

  /** the sides (and for a corner, two sides) cut off along the picture's own axes */
  const cropBy = (h: Handle, c0: Crop, P: Pt, p0: Pt, g: { w0: number; h0: number; co: number; si: number; rot: number; v0: View }): Crop => {
    const dx = P.x - p0.x;
    const dy = P.y - p0.y;
    const lx = dx * g.co + dy * g.si;
    const ly = -dx * g.si + dy * g.co;
    const c = { ...c0 };
    const room = 0.95;
    const lo = (side: keyof Crop) => (stretch ? -3 : inset[side]);
    if (h.includes('l')) c.l = Math.min(room - c.r, Math.max(lo('l'), c.l + lx / g.w0));
    if (h.includes('r')) c.r = Math.min(room - c.l, Math.max(lo('r'), c.r - lx / g.w0));
    if (h.includes('t')) c.t = Math.min(room - c.b, Math.max(lo('t'), c.t + ly / g.h0));
    if (h.includes('b')) c.b = Math.min(room - c.t, Math.max(lo('b'), c.b - ly / g.h0));
    // the side being cut pulls to the canvas edges, middle lines and the other pictures (when the picture is square to the canvas)
    if (!st.current?.fine) {
      const tg = boxTargets(W, H, [selected]);
      let lineX: number | null = null;
      let lineY: number | null = null;
      for (const side of ['l', 'r', 't', 'b'] as const) {
        if (!h.includes(side)) continue;
        const nx = side === 'l' ? -1 : side === 'r' ? 1 : 0;
        const ny = side === 't' ? -1 : side === 'b' ? 1 : 0;
        const ca = Math.cos(g.rot);
        const sa = Math.sin(g.rot);
        const wx = nx * ca - ny * sa;
        const wy = nx * sa + ny * ca;
        const axisX = Math.abs(wx) > 0.98;
        const axisY = Math.abs(wy) > 0.98;
        if (!axisX && !axisY) continue;
        const box = shownBox(g.v0, c, media.width, media.height, W, H);
        const edge = axisX ? (wx > 0 ? box.x + box.w : box.x) : wy > 0 ? box.y + box.h : box.y;
        const list = axisX ? tg.xs : tg.ys;
        let best = 7;
        let hit: number | null = null;
        for (const t of list) if (Math.abs(t - edge) < best) (best = Math.abs(t - edge)), (hit = t);
        if (hit === null) continue;
        const outward = (hit - edge) * (axisX ? Math.sign(wx) : Math.sign(wy)); // how far the edge must move outwards
        const len = side === 'l' || side === 'r' ? g.w0 : g.h0;
        c[side] = Math.min(room, Math.max(lo(side), c[side] - outward / len));
        if (axisX) lineX = hit;
        else lineY = hit;
      }
      showLines(st.current?.frame, lineX, lineY);
    }
    return c;
  };

  const solve = (e: PointerEvent): { view: View; crop: Crop } => {
    const d = st.current!;
    const P = point(e);
    const v0 = d.view0;
    const c0 = d.crop0;
    const s0 = baseScale(media.width, media.height, W, H) * v0.zoom;
    const w0 = media.width * s0;
    const h0 = media.height * s0;
    const a0 = (v0.rot * Math.PI) / 180;
    const co = Math.cos(a0);
    const si = Math.sin(a0);
    const C0 = { x: W / 2 + v0.x * W, y: H / 2 + v0.y * H };
    const loc = (lx: number, ly: number): Pt => ({ x: C0.x + lx * co - ly * si, y: C0.y + lx * si + ly * co });
    const ex0 = -w0 / 2 + c0.l * w0;
    const ex1 = w0 / 2 - c0.r * w0;
    const ey0 = -h0 / 2 + c0.t * h0;
    const ey1 = h0 / 2 - c0.b * h0;
    const env = { sw: media.width, sh: media.height, W, H };

    // while scaling, the edges of what shows pull towards the canvas and the other pictures
    const tg = boxTargets(W, H, [selected]);
    const sbox = shownBox(v0, c0, media.width, media.height, W, H);
    let lx0: number | null = null;
    let ly0: number | null = null;
    const snapK = (kk: number, A: Pt): number => {
      if (d.fine) return kk;
      let best = 7;
      let out = kk;
      lx0 = null;
      ly0 = null;
      for (const e of [sbox.x, sbox.x + sbox.w]) {
        if (Math.abs(e - A.x) < 2) continue;
        const cur = A.x + kk * (e - A.x);
        for (const t of tg.xs) if (Math.abs(cur - t) < best) (best = Math.abs(cur - t)), (out = (t - A.x) / (e - A.x)), (lx0 = t), (ly0 = null);
      }
      for (const e of [sbox.y, sbox.y + sbox.h]) {
        if (Math.abs(e - A.y) < 2) continue;
        const cur = A.y + kk * (e - A.y);
        for (const t of tg.ys) if (Math.abs(cur - t) < best) (best = Math.abs(cur - t)), (out = (t - A.y) / (e - A.y)), (ly0 = t), (lx0 = null);
      }
      showLines(d.frame, lx0, ly0);
      return out > 0.05 ? out : kk;
    };
    const isCorner = d.h === 'tl' || d.h === 'tr' || d.h === 'br' || d.h === 'bl';
    const isSide = d.h === 'l' || d.h === 'r' || d.h === 't' || d.h === 'b';
    if (d.edit && (isCorner || isSide)) return { view: v0, crop: cropBy(d.h, c0, P, d.p0, { w0, h0, co, si, rot: a0, v0 }) };
    if (isSide) {
      // select mode: a side scales the whole picture evenly, holding the opposite side in place (like the sides in OBS)
      const mid = (k: string) => loc(k === 'l' ? ex0 : k === 'r' ? ex1 : (ex0 + ex1) / 2, k === 't' ? ey0 : k === 'b' ? ey1 : (ey0 + ey1) / 2);
      const A = mid({ l: 'r', r: 'l', t: 'b', b: 't' }[d.h as 'l' | 'r' | 't' | 'b']);
      const D = mid(d.h);
      const vx = D.x - A.x;
      const vy = D.y - A.y;
      const k = snapK(((P.x - A.x) * vx + (P.y - A.y) * vy) / (vx * vx + vy * vy || 1), A);
      const zoom = clampZoom(v0.zoom * Math.max(0.05, k));
      const f = zoom / v0.zoom;
      const C = { x: A.x + f * (C0.x - A.x), y: A.y + f * (C0.y - A.y) };
      return { view: clampView({ ...v0, x: (C.x - W / 2) / W, y: (C.y - H / 2) / H, zoom }, env), crop: c0 };
    }
    if (isCorner) {
      const corner = (k: string) => loc(k.includes('l') ? ex0 : ex1, k.includes('t') ? ey0 : ey1);
      const opp = ({ tl: 'br', tr: 'bl', br: 'tl', bl: 'tr' } as Record<string, string>)[d.h]!;
      const A = corner(opp);
      const D = corner(d.h);
      const vx = D.x - A.x;
      const vy = D.y - A.y;
      const k = snapK(((P.x - A.x) * vx + (P.y - A.y) * vy) / (vx * vx + vy * vy || 1), A);
      const zoom = clampZoom(v0.zoom * Math.max(0.05, k));
      const f = zoom / v0.zoom;
      const C = { x: A.x + f * (C0.x - A.x), y: A.y + f * (C0.y - A.y) };
      return { view: clampView({ ...v0, x: (C.x - W / 2) / W, y: (C.y - H / 2) / H, zoom }, env), crop: c0 };
    }
    if (d.h === 'rot') {
      const Cc = loc((ex0 + ex1) / 2, (ey0 + ey1) / 2);
      const ang = (p: Pt) => Math.atan2(p.y - Cc.y, p.x - Cc.x);
      let rot = v0.rot + ((ang(P) - ang(d.p0)) * 180) / Math.PI;
      const q = Math.round(rot / 45) * 45;
      const hit = Math.abs(rot - q) < 3;
      if (hit) rot = q; // a small magnet at every 45 degrees
      if (!d.fine) turnBadge(d.frame, normAngle(rot));
      const dr = ((rot - v0.rot) * Math.PI) / 180;
      const vx = C0.x - Cc.x;
      const vy = C0.y - Cc.y;
      const C = { x: Cc.x + vx * Math.cos(dr) - vy * Math.sin(dr), y: Cc.y + vx * Math.sin(dr) + vy * Math.cos(dr) };
      return { view: clampView({ ...v0, x: (C.x - W / 2) / W, y: (C.y - H / 2) / H, rot: normAngle(rot) }, env), crop: c0 };
    }
    return { view: v0, crop: c0 };
  };

  // pointer events come faster than the screen draws (a mouse or pen can send several hundred a second): the picture is redrawn
  // once per frame with the latest position, as the finger gestures do. Drawing a long, large video on every event made the handles lag.
  const move = (e: PointerEvent) => {
    if (!st.current || st.current.id !== e.pointerId) return;
    const r = solve(e);
    engine.live = { index: selected, view: r.view };
    engine.cropLive = { index: selected, crop: r.crop };
    engine.ghost = !stretch && st.current.edit && st.current.h !== 'rot'; // while cutting, the cut-off part shows faintly
    dragLast.current = r;
    if (dragFrame.current) return;
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = 0;
      const d = st.current;
      const last = dragLast.current;
      if (!d || !last) return;
      setDrag(last);
      if (d.h !== 'rot') hold(d.edit ? 'Crop' : `Scale ${Math.round(last.view.zoom * 100)}%`);
      engine.draw();
    });
  };
  const up = (e: PointerEvent) => {
    const d = st.current;
    if (!d || d.id !== e.pointerId) return;
    // a tap changes nothing by itself (and must not write the old transform back over what a double tap just did)
    const tapped = e.type === 'pointerup' && Math.hypot(d.last.x - d.p0.x, d.last.y - d.p0.y) < 8;
    const r = e.type === 'pointerup' && !tapped ? solve(e) : { view: d.view0, crop: d.crop0 };
    if (tapped) handleTapped();
    cancelAnimationFrame(dragFrame.current);
    dragFrame.current = 0;
    dragLast.current = null;
    showLines(d.frame, null, null);
    endFine();
    st.current = null;
    setDrag(null);
    engine.live = null;
    engine.cropLive = null;
    engine.ghost = false;
    releaseHud();
    if (r.view !== d.view0) updateClip(selected, { view: r.view });
    if (r.crop !== d.crop0) {
      const z = (v: number, i: number) => (!stretch && v <= i + 1e-6 ? 0 : Math.abs(v) < 1e-6 ? 0 : v);
      setCrop(selected, { l: z(r.crop.l, inset.l), t: z(r.crop.t, inset.t), r: z(r.crop.r, inset.r), b: z(r.crop.b, inset.b) });
    }
    engine.draw();
  };

  const poly = [pos.tl, pos.tr, pos.br, pos.bl].map((p) => `${p.x},${p.y}`).join(' ');
  const handle = (h: Handle, cls: string) => (
    <div key={h} class={`tbox-h ${cls}`} style={{ left: `${pos[h].x}px`, top: `${pos[h].y}px`, transform: cls.includes('side') || cls.includes('crop') ? `rotate(${view.rot}deg)` : undefined }} onPointerDown={down(h)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label={h === 'rot' ? 'Turn' : cls.includes('side') ? (stretch ? `Stretch ${h}` : `Crop ${h}`) : 'Scale'} />
  );
  return (
    <>
      <svg class={`tbox ${editing ? 'edit' : ''}`} width={W} height={H} aria-hidden="true">
        <polygon points={poly} />
        {!editing && <line x1={at(xm, y0).x} y1={at(xm, y0).y} x2={pos.rot.x} y2={pos.rot.y} />}
      </svg>
      {!quiet && handle('t', `side h ${editing ? 'editbar' : ''}`)}
      {!quiet && handle('b', `side h ${editing ? 'editbar' : ''}`)}
      {!quiet && handle('l', `side v ${editing ? 'editbar' : ''}`)}
      {!quiet && handle('r', `side v ${editing ? 'editbar' : ''}`)}
      {!quiet && handle('tl', editing ? 'corner crop tl' : 'corner')}
      {!quiet && handle('tr', editing ? 'corner crop tr' : 'corner')}
      {!quiet && handle('br', editing ? 'corner crop br' : 'corner')}
      {!quiet && handle('bl', editing ? 'corner crop bl' : 'corner')}
      {!quiet && !editing && handle('rot', 'rotor')}
    </>
  );
}

type Clip1 = ReturnType<typeof getState>['project']['clips'][number];
type Media1 = ReturnType<typeof getState>['project']['media'][string];

/** The four corners of what a strip shows on the canvas (cropped, and for text the area of the letters). */
function quadOf(c: Clip1, m: Media1, W: number, H: number): Pt[] {
  const inset: Crop = m.textBox ?? { l: 0, t: 0, r: 0, b: 0 };
  const cr: Crop = c.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const k: Crop = m.solid !== undefined ? cr : { l: Math.max(cr.l, inset.l), t: Math.max(cr.t, inset.t), r: Math.max(cr.r, inset.r), b: Math.max(cr.b, inset.b) };
  const sc = baseScale(m.width, m.height, W, H) * c.view.zoom;
  const pw = m.width * sc;
  const ph = m.height * sc;
  const a = (c.view.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = W / 2 + c.view.x * W;
  const cy = H / 2 + c.view.y * H;
  const xs = [-pw / 2 + k.l * pw, pw / 2 - k.r * pw];
  const ys = [-ph / 2 + k.t * ph, ph / 2 - k.b * ph];
  return [
    [xs[0]!, ys[0]!],
    [xs[1]!, ys[0]!],
    [xs[1]!, ys[1]!],
    [xs[0]!, ys[1]!],
  ].map(([lx, ly]) => ({ x: cx + lx! * cos - ly! * sin, y: cy + lx! * sin + ly! * cos }));
}

/**
 * One box around the picked strips that are under the yellow line. Corners scale and the round handle turns
 * them all together, like a group; strips that are picked but not on screen at this moment are left alone.
 */
/** tells the group box that the strips are moving (or stopped) so it follows them */
function pingGroup(): void {
  window.dispatchEvent(new Event('pc-group-live'));
}

function GroupBox({ boxW: W, boxH: H }: { boxW: number; boxH: number }) {
  const multi = useStore((s) => s.multi);
  const clips = useStore((s) => s.project.clips);
  const mediaMap = useStore((s) => s.project.media);
  const playhead = useStore((s) => s.playhead);
  const [drag, setDrag] = useState<{ f: number; dr: number; P: Pt } | null>(null);
  const [, setPing] = useState(0);
  useEffect(() => {
    const on = () => setPing((n) => n + 1);
    window.addEventListener('pc-group-live', on);
    return () => window.removeEventListener('pc-group-live', on);
  }, []);
  const gFrame = useRef(0);
  const gLast = useRef<{ f: number; dr: number; P: Pt } | null>(null);
  const st = useRef<{ id: number; h: Handle; p0: Pt; raw0: Pt; off: Pt; moved: boolean; last: Pt; anchor: Pt; fineRaw: Pt; fineEff: Pt; fine: boolean; timer: number; frame: HTMLElement | null; members: { i: number; v: View }[]; box: { l: number; t: number; r: number; b: number } } | null>(null);

  const members = multi.length === 0 ? [] : activeAt(clips, playhead).filter((i) => multi.includes(clips[i]!.id) && mediaMap[clips[i]!.mediaId] && mediaMap[clips[i]!.mediaId]!.kind !== 'audio');
  const key = members.join();
  const endFine = () => {
    const d = st.current;
    if (!d) return;
    clearTimeout(d.timer);
    d.frame?.classList.remove('fine');
    hudEndFine();
  };
  const cancel = () => {
    if (!st.current) return;
    cancelAnimationFrame(gFrame.current);
    gFrame.current = 0;
    endFine();
    st.current = null;
    setDrag(null);
    engine.liveMany = null;
    engine.draw();
  };
  useEffect(cancel, [key]);
  if (members.length === 0) return null;

  // the box around all of them, as it is at rest
  const liveOf = (i: number): Clip => (engine.liveMany?.has(i) ? { ...clips[i]!, view: engine.liveMany.get(i)! } : clips[i]!);
  const pts = members.flatMap((i) => quadOf(liveOf(i), mediaMap[clips[i]!.mediaId]!, W, H));
  const rest = { l: Math.min(...pts.map((p) => p.x)), t: Math.min(...pts.map((p) => p.y)), r: Math.max(...pts.map((p) => p.x)), b: Math.max(...pts.map((p) => p.y)) };
  const box = st.current?.box ?? rest;
  const base: Record<Handle, Pt> = {
    tl: { x: box.l, y: box.t },
    tr: { x: box.r, y: box.t },
    br: { x: box.r, y: box.b },
    bl: { x: box.l, y: box.b },
    l: { x: box.l, y: (box.t + box.b) / 2 },
    r: { x: box.r, y: (box.t + box.b) / 2 },
    t: { x: (box.l + box.r) / 2, y: box.t },
    b: { x: (box.l + box.r) / 2, y: box.b },
    rot: { x: (box.l + box.r) / 2, y: box.t - 34 },
  };
  const turn = (p: Pt, f: number, dr: number, P: Pt): Pt => {
    const cos = Math.cos(dr);
    const sin = Math.sin(dr);
    const dx = p.x - P.x;
    const dy = p.y - P.y;
    return { x: P.x + f * (dx * cos - dy * sin), y: P.y + f * (dx * sin + dy * cos) };
  };
  const pos = (h: Handle): Pt => {
    if (!drag) return base[h];
    // the handle above the box keeps its distance while the box scales
    if (h === 'rot') {
      const top = turn(base.t, drag.f, drag.dr, drag.P);
      const c = turn({ x: (box.l + box.r) / 2, y: (box.t + box.b) / 2 }, drag.f, drag.dr, drag.P);
      const vx = top.x - c.x;
      const vy = top.y - c.y;
      const len = Math.hypot(vx, vy) || 1;
      return { x: top.x + (vx / len) * 34, y: top.y + (vy / len) * 34 };
    }
    return turn(base[h], drag.f, drag.dr, drag.P);
  };

  const frameBox = (e: PointerEvent): Pt => localPoint((e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect(), e.clientX, e.clientY);
  const down = (h: Handle) => (e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (fingers.size > 1) return;
    engine.pause();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone */
    }
    const raw0 = frameBox(e);
    const p0 = { x: pos(h).x, y: pos(h).y };
    const off = { x: p0.x - raw0.x, y: p0.y - raw0.y };
    const d = { id: e.pointerId, h, p0, raw0, off, moved: false, last: p0, anchor: p0, fineRaw: p0, fineEff: p0, fine: false, timer: 0, frame: (e.currentTarget as HTMLElement).parentElement, members: members.map((i) => ({ i, v: clips[i]!.view })), box: rest };
    st.current = d;
    const arm = () => {
      clearTimeout(d.timer);
      d.timer = window.setTimeout(() => {
        if (st.current !== d || d.fine) return;
        d.fine = true;
        d.fineRaw = d.last;
        d.fineEff = d.last;
        d.frame?.classList.add('fine');
        startFine();
        haptic(14);
      }, HOLD_MS);
    };
    (d as { arm?: () => void }).arm = arm;
    if (h !== 'rot') arm();
  };
  const point = (e: PointerEvent): Pt => {
    const d = st.current!;
    const rawF = frameBox(e);
    const raw = { x: rawF.x + d.off.x, y: rawF.y + d.off.y };
    d.last = raw;
    if (!d.fine && !d.moved) {
      if (Math.hypot(rawF.x - d.raw0.x, rawF.y - d.raw0.y) < 6) return d.p0;
      d.moved = true;
    }
    if (d.fine) return { x: d.fineEff.x + (raw.x - d.fineRaw.x) * 0.1, y: d.fineEff.y + (raw.y - d.fineRaw.y) * 0.1 };
    if (Math.hypot(raw.x - d.anchor.x, raw.y - d.anchor.y) > 10) {
      d.anchor = raw;
      clearTimeout(d.timer); // dragging ends the chance of fine control: it only starts from a hold
    }
    return raw;
  };
  const solve = (e: PointerEvent): { f: number; dr: number; P: Pt } => {
    const d = st.current!;
    const P = point(e);
    const b = d.box;
    if (d.h === 'rot') {
      const C = { x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 };
      const ang = (p: Pt) => Math.atan2(p.y - C.y, p.x - C.x);
      let deg = ((ang(P) - ang(d.p0)) * 180) / Math.PI;
      const q = Math.round(deg / 45) * 45;
      const hit = Math.abs(deg - q) < 3;
      if (hit) deg = q;
      if (!d.fine) turnBadge(d.frame, hit ? normAngle(q) : null);
      return { f: 1, dr: (deg * Math.PI) / 180, P: C };
    }
    const corner = (k: string): Pt => ({ x: k.includes('l') ? b.l : b.r, y: k.includes('t') ? b.t : b.b });
    const opp = ({ tl: 'br', tr: 'bl', br: 'tl', bl: 'tr' } as Record<string, string>)[d.h] ?? 'br';
    const A = corner(opp);
    const D = corner(d.h);
    const vx = D.x - A.x;
    const vy = D.y - A.y;
    let f = Math.max(0.05, ((P.x - A.x) * vx + (P.y - A.y) * vy) / (vx * vx + vy * vy || 1));
    // no strip may leave the allowed zoom range: the group stops when the first one does
    const zs = d.members.map((m) => m.v.zoom);
    f = Math.min(f, clampZoom(1e9) / Math.max(...zs));
    f = Math.max(f, clampZoom(0) / Math.min(...zs));
    return { f, dr: 0, P: A };
  };
  const views = (t: { f: number; dr: number; P: Pt }): [number, View][] =>
    st.current!.members.map(({ i, v }) => {
      const c = turn({ x: W / 2 + v.x * W, y: H / 2 + v.y * H }, t.f, t.dr, t.P);
      return [i, { x: (c.x - W / 2) / W, y: (c.y - H / 2) / H, zoom: clampZoom(v.zoom * t.f), rot: normAngle(v.rot + (t.dr * 180) / Math.PI) }];
    });
  const move = (e: PointerEvent) => {
    if (!st.current || st.current.id !== e.pointerId) return;
    const t = solve(e);
    engine.liveMany = new Map(views(t));
    gLast.current = t;
    if (gFrame.current) return; // once per screen frame, like the single box
    gFrame.current = requestAnimationFrame(() => {
      gFrame.current = 0;
      const l = gLast.current;
      if (!l || !st.current) return;
      setDrag(l);
      engine.draw();
    });
  };
  const up = (e: PointerEvent) => {
    const d = st.current;
    if (!d || d.id !== e.pointerId) return;
    const tapped = e.type === 'pointerup' && Math.hypot(d.last.x - d.p0.x, d.last.y - d.p0.y) < 8;
    if (tapped) handleTapped();
    cancelAnimationFrame(gFrame.current);
    gFrame.current = 0;
    const t = e.type === 'pointerup' && !tapped ? solve(e) : null;
    const out = t ? views(t) : [];
    endFine();
    st.current = null;
    setDrag(null);
    engine.liveMany = null;
    if (t) setViews(out);
    engine.draw();
  };

  const poly = (['tl', 'tr', 'br', 'bl'] as Handle[]).map((h) => `${pos(h).x},${pos(h).y}`).join(' ');
  const handle = (h: Handle, cls: string) => (
    <div key={h} class={`tbox-h ${cls}`} style={{ left: `${pos(h).x}px`, top: `${pos(h).y}px` }} onPointerDown={down(h)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label={h === 'rot' ? 'Turn all' : 'Scale all'} />
  );
  const top = pos('t' as Handle);
  const topMid = { x: (pos('tl').x + pos('tr').x) / 2, y: (pos('tl').y + pos('tr').y) / 2 };
  void top;
  return (
    <>
      <svg class="tbox glow" width={W} height={H} aria-hidden="true">
        {members.map((i) => (
          <polygon key={clips[i]!.id} points={quadOf(liveOf(i), mediaMap[clips[i]!.mediaId]!, W, H).map((p) => `${p.x},${p.y}`).join(' ')} />
        ))}
      </svg>
      <svg class="tbox group" width={W} height={H} aria-hidden="true">
        <polygon points={poly} />
        <line x1={topMid.x} y1={topMid.y} x2={pos('rot').x} y2={pos('rot').y} />
      </svg>
      {handle('tl', 'corner')}
      {handle('tr', 'corner')}
      {handle('br', 'corner')}
      {handle('bl', 'corner')}
      {handle('rot', 'rotor')}
    </>
  );
}
