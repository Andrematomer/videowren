import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { bakedAudio, keyOf } from './bake.ts';
import { drawLayer } from './layers.ts';
import { activeAt, clipEnd, sourceAt, totalOf } from './timeline.ts';
import type { Clip, Crop, Project, View } from './types.ts';

export interface PreviewDeps {
  getProject(): Project;
  getUrl(mediaId: string): string | undefined;
  /** the decoded picture when the clip is a still image */
  getImage(mediaId: string): ImageBitmap | undefined;
  /** true while the small preview copy of a video is being made: the video itself is not played then */
  isBuilding(mediaId: string): boolean;
  /** a grey picture of the first frame (shown in place of a video that is being prepared) */
  getGray(mediaId: string): CanvasImageSource | undefined;
  /** the moving light drawn over a video that is being prepared (transparent elsewhere, same size as the grey picture) */
  getWave(mediaId: string): CanvasImageSource | undefined;
  /** long side (pixels) of the quick frames shown while the preview copy is being made */
  frameLong(): number;
  /** runs a job before the making of the preview copies (which pauses meanwhile) */
  priority<T>(f: () => Promise<T>): Promise<T>;
  /** the full-size picture of a photo (the preview normally draws a smaller copy) */
  getFullImage(mediaId: string): ImageBitmap | undefined;
  /** true when a video is shown from its small preview copy */
  hasProxy(mediaId: string): boolean;
  /** the original file (its sound is what gets baked for the preview) */
  getBlob(mediaId: string): Blob | undefined;
  onTime(t: number): void;
  onPlaying(playing: boolean): void;
  /** what to do when playback reaches the end */
  getEnd(): 'pause' | 'stop' | 'loop' | 'return';
}

const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
void IOS;

/** how many videos may be decoded at the same time (each one needs a hardware decoder on a phone) */
const POOL = 4;
/** videos about to start are loaded this many seconds ahead, so cuts do not stall */
const LOOKAHEAD = 1.5;
/** clips longer than this keep their own sound instead of a rendered copy (memory) */
const BAKE_MAX_SECONDS = 180;
/** the video may be this far from where the clock says before it is pulled back */
const DRIFT = 0.3;

interface Player {
  video: HTMLVideoElement;
  clipId: string | null;
  mediaId: string | null;
  url: string;
  ready: boolean;
  /** source time to jump to once the file has loaded */
  want: number | null;
}

interface Sound {
  src: AudioBufferSourceNode;
  gain: GainNode;
  key: string;
}

/**
 * Preview player for a multi-lane timeline. A clock drives the timeline. A small pool of hidden
 * <video> elements decodes the clips that are playing (or about to); each frame the active clips are
 * painted on one canvas, lowest lane first. Sound does not come from the video elements: the sound
 * of every clip is rendered once (with the speed applied, like the export does) and played through
 * Web Audio, so it is mixed, has a working volume on iPhone, and does not depend on how well the
 * browser plays a video at an odd speed.
 */
export class PreviewEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private players: Player[] = [];
  private raf = 0;
  private token = 0;
  tl = 0;
  playing = false;
  /** while a finger is moving a picture, this view is drawn instead of the saved one */
  live: { index: number; view: View } | null = null;
  /** views of several strips being moved together by the group box (clip index to view) */
  liveMany: Map<number, View> | null = null;
  isolate = false;
  /** the split view while an edge of a strip is trimmed: the frame at the fixed edge (a snapshot) next to the live one */
  split: { liveSide: 'left' | 'right'; still: HTMLCanvasElement | null; labels: [string, string] } | null = null;
  private splitLabels: [string, string] = ['', ''];
  private splitBusy = false;
  private fromSplit = false;
  private pendingScrub: { index: number; t: number; report: boolean } | null = null;
  private liveSnap: HTMLCanvasElement | null = null;
  /** recording a voice: the position keeps running past the last strip (and over an empty timeline) */
  openEnd = false;
  /** the sound of the strips is not played (a voice is being recorded) */
  silent = false;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(1024);
  /** where the sound goes: through one gain and one meter, then out */
  private out(): AudioNode {
    const a = this.actx!;
    if (!this.master) {
      this.master = a.createGain();
      this.analyser = a.createAnalyser();
      this.analyser.fftSize = 1024;
      this.master.connect(this.analyser);
      this.analyser.connect(a.destination);
    }
    this.master.gain.value = this.silent ? 0 : 1;
    return this.master;
  }
  /** the loudness right now at the output (0 to 1, 1 and above is clipping) */
  level(): { peak: number; rms: number } {
    const an = this.analyser;
    if (!an || !this.playing) return { peak: 0, rms: 0 };
    an.getFloatTimeDomainData(this.buf as Float32Array<ArrayBuffer>);
    let peak = 0;
    let sum = 0;
    for (const v of this.buf) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
    return { peak, rms: Math.sqrt(sum / this.buf.length) };
  }
  /** crop being dragged on screen (not yet saved to the clip) */
  cropLive: { index: number; crop: Crop } | null = null;
  /** while cutting, the whole uncropped picture is drawn faintly behind the cut one */
  ghost = false;
  /**
   * Paused and not being scrubbed: photos and videos are drawn from their full-size originals instead of the small preview
   * copies (playing and moving a picture keep using the small ones). A video needs one frame decoded from the original,
   * which starts the moment the position is set and no finger is holding the seek (`holding`).
   */
  private fullOk = false;
  private settleQueued = false;
  private inflight = new Set<string>();
  /** a finger (or an animation) is moving the position: no full-size frame is made until it lets go */
  holding = false;
  /** the position was released: make the full-size frames now */
  letGo(): void {
    this.holding = false;
    if (!this.playing) this.settle();
  }
  /** true when the full-size frame of this clip at the shown time is ready */
  hasFullFrame(clipId: string): boolean {
    const clip = this.deps.getProject().clips.find((c) => c.id === clipId);
    const f = clip && this.full.get(clipId);
    return !!clip && !!f && f.media === clip.mediaId && Math.abs(f.t - sourceAt(clip, this.tl)) < 0.03;
  }
  private fullGen = 0;
  private full = new Map<string, { media: string; t: number; c: CanvasImageSource & { width: number; height: number }; big: boolean }>();
  private unsettle(): void {
    this.fullOk = false;
    this.fullGen++;
  }
  private settle(): void {
    if (this.playing || this.holding) return;
    this.fullOk = true;
    this.draw();
    const p = this.deps.getProject();
    const here = new Set(activeAt(p.clips, this.tl).map((i) => p.clips[i]!.id));
    for (const id of [...this.full.keys()]) if (!here.has(id)) this.full.delete(id); // a full-size frame is big: only the ones on screen are kept
    for (const i of activeAt(p.clips, this.tl)) {
      const clip = p.clips[i]!;
      const media = p.media[clip.mediaId];
      if (!media || media.kind === 'image' || media.kind === 'audio' || !(this.deps.hasProxy(clip.mediaId) || this.deps.isBuilding(clip.mediaId))) continue;
      const t = sourceAt(clip, this.tl);
      const have = this.full.get(clip.id);
      const same = !!have && have.media === clip.mediaId && Math.abs(have.t - t) < 0.03;
      if (same && have.big) continue;
      const blob = this.deps.getBlob(clip.mediaId);
      if (!blob) continue;
      const key = `${clip.id}@${t.toFixed(3)}`;
      if (this.inflight.has(key)) continue;
      this.inflight.add(key);
      const gen = this.fullGen;
      const building = this.deps.isBuilding(clip.mediaId);
      const store = (c: (CanvasImageSource & { width: number; height: number }) | null, big: boolean): boolean => {
        if (!c || gen !== this.fullGen) return false; // the position moved on meanwhile
        this.full.set(clip.id, { media: clip.mediaId, t, c, big });
        this.draw();
        return true;
      };
      void (async () => {
        try {
          // while the preview copy is being made: first a quick frame at preview size (the copy pauses meanwhile), then the full-size one.
          // With a copy already there the preview is small anyway, so the full-size frame comes straight away.
          if (building && !same) store(await this.deps.priority(() => this.fullFrame(blob, media.width, media.height, t, this.deps.frameLong())), false);
          const run = () => this.fullFrame(blob, media.width, media.height, t, 1920);
          store(await (building ? this.deps.priority(run) : run()), true);
        } finally {
          this.inflight.delete(key);
        }
      })();
    }
  }
  /** one frame of the original file at source time t, at most 1920 px on the long side */
  private async fullFrame(blob: Blob, w: number, h: number, t: number, long: number): Promise<(CanvasImageSource & { width: number; height: number }) | null> {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) return null;
      const k = Math.min(1, long / Math.max(w, h));
      const sink = new CanvasSink(vt, { width: Math.max(2, Math.round(w * k)), height: Math.max(2, Math.round(h * k)), fit: 'fill' });
      const f = await sink.getCanvas(t);
      return (f?.canvas as (CanvasImageSource & { width: number; height: number }) | undefined) ?? null;
    } catch {
      return null;
    } finally {
      (input as unknown as { dispose?: () => void }).dispose?.();
    }
  }
  /** where the position marker was when play was pressed (for the "return" end mode) */
  private playFrom = 0;

  private clockT0 = 0;
  private clockTl0 = 0;
  /** a clip shown by the trim bar at a source time, whatever the timeline says */
  private scrub: { index: number; t: number } | null = null;

  private actx: AudioContext | null = null;
  private sounds = new Map<string, Sound>();
  private pending = new Set<string>();

  constructor(private deps: PreviewDeps) {
    for (let i = 0; i < POOL; i++) this.players.push(this.makePlayer());
    const wake = () => this.wakeAudio();
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('touchend', wake, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pause();
        void this.actx?.suspend().catch(() => {});
      } else {
        this.wakeAudio();
        requestAnimationFrame(() => this.draw());
      }
    });
    this.hideFromLockScreen();
  }

  private makePlayer(): Player {
    const v = document.createElement('video');
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto';
    v.muted = true;
    v.preservesPitch = true;
    v.disableRemotePlayback = true;
    v.setAttribute('x-webkit-airplay', 'deny');
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(v);
    const p: Player = { video: v, clipId: null, mediaId: null, url: '', ready: false, want: null };
    v.addEventListener('loadeddata', () => {
      p.ready = true;
      if (p.want !== null) {
        try {
          v.currentTime = p.want;
        } catch {
          /* not seekable yet */
        }
        p.want = null;
      }
      if (!this.playing) this.draw();
    });
    v.addEventListener('seeked', () => {
      if (!this.playing) this.draw();
    });
    v.addEventListener('play', () => this.hideFromLockScreen());
    return p;
  }

  /** best effort: an empty "now playing" entry. iOS may still show a bare player while sound plays. */
  private hideFromLockScreen(): void {
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (!ms) return;
    try {
      ms.metadata = null;
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto', 'stop'] as MediaSessionAction[]) ms.setActionHandler(a, null);
    } catch {
      /* some actions are not known to this browser */
    }
  }

  /** the picture on screen right now as a PNG (preview size): the fallback when the full-size picture can not be made */
  snapshot(): Promise<Blob | null> {
    const c = this.canvas;
    if (!c) return Promise.resolve(null);
    this.draw();
    return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
  }
  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
    this.draw();
  }

  destroy(): void {
    this.token++;
    cancelAnimationFrame(this.raf);
    this.stopSounds();
    for (const p of this.players) {
      p.video.pause();
      p.video.removeAttribute('src');
      p.video.load();
      p.video.remove();
    }
  }

  /** whether the preview loudness follows the volume setting (it always does: sound plays through Web Audio) */
  volumeWorks(): boolean {
    return true;
  }

  /** call from a tap: a Web Audio context only starts after a gesture */
  wakeAudio(): void {
    if (!this.actx) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.actx = new Ctx();
      } catch {
        return;
      }
    }
    void this.actx.resume().catch(() => {});
  }

  /** the clip that is on screen on top right now (what a finger on the preview moves) */
  currentIndex(): number {
    const clips = this.deps.getProject().clips;
    const shown = activeAt(clips, this.tl).filter((i) => this.deps.getProject().media[clips[i]!.mediaId]?.kind !== 'audio');
    return shown.length ? shown[shown.length - 1]! : -1;
  }

  // ---------- drawing ----------

  /** called after every drawing (the note over a building video follows the picture while it is moved) */
  onDraw: (() => void) | null = null;
  draw(): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!this.fullOk && !this.playing && !this.holding && !this.settleQueued) {
      this.settleQueued = true;
      queueMicrotask(() => ((this.settleQueued = false), this.settle()));
    }
    const p = this.deps.getProject();
    ctx.fillStyle = p.settings.background || '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // while an edge of a strip is trimmed, the preview shows that strip alone, at the frame the edge is on
    const list = this.isolate && this.scrub ? new Set([this.scrub.index]) : new Set(activeAt(p.clips, this.tl));
    if (this.scrub) list.add(this.scrub.index);
    const order = [...list].sort((a, b) => (p.clips[a]?.track ?? 0) - (p.clips[b]?.track ?? 0) || a - b);
    for (const i of order) {
      const clip = p.clips[i];
      const media = clip && p.media[clip.mediaId];
      if (!clip || !media || media.kind === 'audio') continue;
      const o = { outW: canvas.width, outH: canvas.height, view: this.liveMany?.get(i) ?? (this.live && this.live.index === i ? this.live.view : clip.view), keepBackground: true };
      // effects are off while a picture is being moved, turned or cropped, and come back on release
      const look = { opacity: clip.opacity, grade: clip.grade, fx: clip.fx, crop: this.cropLive && this.cropLive.index === i ? this.cropLive.crop : clip.crop };
      const faint = this.ghost && this.cropLive?.index === i ? { ...look, crop: undefined, opacity: (look.opacity ?? 1) * 0.35 } : null;
      if (media.kind !== 'image' && this.deps.isBuilding(clip.mediaId)) {
        // the latest frame that was made stays on screen (also while the position moves: it is replaced when the new one is ready);
        // before there is one, the first frame. The moving light is always on top.
        const f = this.full.get(clip.id);
        const base = f && f.media === clip.mediaId ? { c: f.c as CanvasImageSource, w: f.c.width, h: f.c.height } : undefined;
        const g = this.deps.getGray(clip.mediaId) as (CanvasImageSource & { width: number; height: number }) | undefined;
        const w = this.deps.getWave(clip.mediaId) as (CanvasImageSource & { width: number; height: number }) | undefined;
        const b = base ?? (g ? { c: g as CanvasImageSource, w: g.width, h: g.height } : undefined);
        if (b) drawLayer(ctx, b.c, b.w, b.h, base ? look : { opacity: look.opacity, crop: look.crop }, base ? o : { ...o, srcW: g!.width, srcH: g!.height });
        if (w) drawLayer(ctx, w, media.width, media.height, { opacity: look.opacity, crop: look.crop }, { ...o, srcW: w.width, srcH: w.height });
        continue;
      }
      const still = this.fullOk && !this.playing && !this.live && !this.liveMany && !this.cropLive;
      const img = (still && media.kind === 'image' ? this.deps.getFullImage(clip.mediaId) : undefined) ?? this.deps.getImage(clip.mediaId);
      if (img) {
        if (faint) drawLayer(ctx, img, img.width, img.height, faint, o);
        drawLayer(ctx, img, img.width, img.height, look, o);
        continue;
      }
      const hi = still ? this.full.get(clip.id) : undefined;
      if (hi && hi.media === clip.mediaId && Math.abs(hi.t - sourceAt(clip, this.tl)) < 0.03) {
        drawLayer(ctx, hi.c, hi.c.width, hi.c.height, look, o);
        continue;
      }
      const pl = this.players.find((x) => x.clipId === clip.id);
      const v = pl?.video;
      if (pl && v && pl.ready && v.readyState >= 2 && v.videoWidth) {
        if (faint) drawLayer(ctx, v, v.videoWidth, v.videoHeight, faint, o);
        drawLayer(ctx, v, v.videoWidth, v.videoHeight, look, o);
      }
    }
    if (this.split && this.isolate && this.scrub && !this.splitBusy) this.composeSplit();
    this.onDraw?.();
  }

  /** replaces the picture by two halves: the first frame kept (left) and the last frame kept (right) of the strip being trimmed, each as the strip really looks (position, size, crop) */
  private composeSplit(): void {
    const ctx = this.ctx;
    const c = this.canvas;
    const sp = this.split;
    if (!ctx || !c || !sp) return;
    const W = c.width;
    const H = c.height;
    const snap = (this.liveSnap ??= document.createElement('canvas'));
    snap.width = W;
    snap.height = H;
    snap.getContext('2d')!.drawImage(c, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const gap = Math.max(4, W * 0.006);
    const pw = (W - gap) / 2;
    const k = pw / W;
    const ph = H * k;
    const y = (H - ph) / 2;
    const left = sp.liveSide === 'left' ? snap : sp.still;
    const right = sp.liveSide === 'left' ? sp.still : snap;
    if (left) ctx.drawImage(left, 0, y, pw, ph);
    if (right) ctx.drawImage(right, pw + gap, y, pw, ph);
    ctx.fillStyle = '#ffc933';
    ctx.fillRect(pw, 0, gap, H);
    const fs = Math.max(12, Math.round(W * 0.034));
    ctx.font = `700 ${fs}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = fs * 0.28;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.fillStyle = '#fff';
    this.splitLabels.forEach((t, i) => {
      const x = (i === 0 ? 0 : pw + gap) + fs * 0.6;
      ctx.strokeText(t, x, y + fs * 0.5);
      ctx.fillText(t, x, y + fs * 0.5);
    });
  }

  /** the trim of an edge begins: the frame at the other edge is kept as the fixed half of the split view */
  async beginSplit(index: number, liveSide: 'left' | 'right', stillT: number, liveT: number): Promise<void> {
    this.isolate = true;
    this.split = { liveSide, still: null, labels: ['', ''] };
    this.splitBusy = true;
    const sp = this.split;
    const keep = this.split;
    this.split = null;
    this.fromSplit = true;
    this.scrubSource(index, stillT, false);
    this.fromSplit = false;
    while (this.scrubbing || this.scrubTarget) await new Promise((r) => setTimeout(r, 16));
    const c = this.canvas;
    if (c && this.isolate) {
      const st = document.createElement('canvas');
      st.width = c.width;
      st.height = c.height;
      st.getContext('2d')!.drawImage(c, 0, 0);
      sp.still = st;
    }
    this.splitBusy = false;
    if (!this.isolate) return;
    this.split = keep;
    const p = this.pendingScrub;
    this.pendingScrub = null;
    this.scrubSource(p?.index ?? index, p?.t ?? liveT, false);
  }
  setSplitLabels(a: string, b: string): void {
    this.splitLabels = [a, b];
  }
  endSplit(): void {
    this.isolate = false;
    this.split = null;
    this.splitBusy = false;
    this.pendingScrub = null;
  }

  // ---------- the pool of video elements ----------

  /** gives the clip a video element (loading its file if needed). Returns null when every element is busy. */
  private assign(clip: Clip, keep: Set<string>): Player | null {
    let pl = this.players.find((x) => x.clipId === clip.id);
    if (!pl) {
      pl = this.players.find((x) => x.clipId === null) ?? this.players.find((x) => x.clipId !== null && !keep.has(x.clipId));
      if (!pl) return null;
      pl.video.pause();
      pl.clipId = clip.id;
      pl.mediaId = null;
      pl.url = '';
      pl.ready = false;
    }
    const url = this.deps.getUrl(clip.mediaId) ?? '';
    // a new preview copy appeared: swap files only while the element is not showing the clip live
    if (pl.mediaId !== clip.mediaId || (pl.url !== url && !this.playing)) {
      pl.mediaId = clip.mediaId;
      pl.url = url;
      pl.ready = false;
      pl.want = clip.start;
      pl.video.src = url;
      pl.video.load();
    }
    return pl;
  }

  private release(pl: Player): void {
    pl.video.pause();
    pl.clipId = null;
    pl.mediaId = null;
    pl.ready = false;
    pl.want = null;
  }

  private seekPlayer(pl: Player, time: number): Promise<void> {
    const v = pl.video;
    return new Promise((resolve) => {
      if (!pl.ready) {
        pl.want = time;
        const t = window.setTimeout(resolve, 2500);
        const on = () => {
          clearTimeout(t);
          v.removeEventListener('seeked', on);
          resolve();
        };
        v.addEventListener('seeked', on);
        return;
      }
      if (Math.abs(v.currentTime - time) < 0.002 && v.readyState >= 2) return resolve();
      const t = window.setTimeout(resolve, 1500);
      const on = () => {
        clearTimeout(t);
        v.removeEventListener('seeked', on);
        resolve();
      };
      v.addEventListener('seeked', on);
      try {
        v.currentTime = time;
      } catch {
        resolve();
      }
    });
  }

  private isVideo(clip: Clip): boolean {
    const m = this.deps.getProject().media[clip.mediaId];
    return !!m && m.kind !== 'image' && m.kind !== 'audio' && !this.deps.isBuilding(clip.mediaId);
  }

  /** makes the pool match the timeline at time t: playing clips (and the ones about to start) have an element */
  private sync(t: number, running: boolean): void {
    const clips = this.deps.getProject().clips;
    const active = activeAt(clips, t).filter((i) => this.isVideo(clips[i]!));
    const soon = clips
      .map((c, i) => i)
      .filter((i) => this.isVideo(clips[i]!) && clips[i]!.at > t && clips[i]!.at - t <= LOOKAHEAD && !active.includes(i));
    const wanted = [...active.slice().reverse(), ...soon]; // top lanes first when the pool is short
    const keep = new Set(wanted.map((i) => clips[i]!.id));
    if (this.scrub && clips[this.scrub.index]) keep.add(clips[this.scrub.index]!.id);
    for (const pl of this.players) if (pl.clipId && !keep.has(pl.clipId)) this.release(pl);
    for (const i of wanted.slice(0, POOL)) {
      const clip = clips[i]!;
      const pl = this.assign(clip, keep);
      if (!pl) continue;
      const v = pl.video;
      const isActive = active.includes(i);
      if (!isActive) {
        // waiting for its turn: parked on its first frame
        if (!v.paused) v.pause();
        continue;
      }
      const wantT = sourceAt(clip, t);
      const own = !this.bakeable(clip);
      v.muted = !own || clip.volume <= 0 || this.silent;
      if (own) v.volume = Math.max(0, Math.min(1, clip.volume));
      if (Math.abs(v.playbackRate - clip.speed) > 1e-3) {
        v.playbackRate = clip.speed;
        v.defaultPlaybackRate = clip.speed;
      }
      v.preservesPitch = clip.keepPitch;
      (v as HTMLVideoElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = clip.keepPitch;
      if (!pl.ready) {
        pl.want = wantT;
        continue;
      }
      if (running) {
        if (Math.abs(v.currentTime - wantT) > DRIFT && !v.seeking) {
          try {
            v.currentTime = wantT;
          } catch {
            /* ignore */
          }
        }
        if (v.paused) void v.play().catch(() => {});
      } else if (!v.paused) v.pause();
    }
  }

  // ---------- sound ----------

  private bakeable(clip: Clip): boolean {
    const media = this.deps.getProject().media[clip.mediaId];
    return !!media?.hasAudio && !!this.deps.getBlob(clip.mediaId) && clip.end - clip.start <= BAKE_MAX_SECONDS;
  }

  private stopSounds(): void {
    for (const s of this.sounds.values()) {
      try {
        s.src.stop();
      } catch {
        /* already stopped */
      }
      s.src.disconnect();
      s.gain.disconnect();
    }
    this.sounds.clear();
    this.pending.clear();
  }

  /** starts, updates or stops the sound of every clip for the current timeline time */
  private syncSounds(t: number, token: number): void {
    const clips = this.deps.getProject().clips;
    const active = new Set(activeAt(clips, t).map((i) => clips[i]!.id));
    for (const [id, s] of this.sounds) {
      const c = clips.find((x) => x.id === id);
      if (!c || !active.has(id) || s.key !== keyOf(c)) {
        try {
          s.src.stop();
        } catch {
          /* already stopped */
        }
        s.src.disconnect();
        s.gain.disconnect();
        this.sounds.delete(id);
      } else s.gain.gain.value = c.volume;
    }
    const actx = this.actx;
    if (!actx) return;
    const startFor = (c: Clip) => {
      if (!this.bakeable(c) || this.sounds.has(c.id) || this.pending.has(c.id) || c.volume <= 0) return;
      const blob = this.deps.getBlob(c.mediaId)!;
      const key = keyOf(c);
      this.pending.add(c.id);
      void bakedAudio(blob, c).then((buf) => {
        this.pending.delete(c.id);
        if (token !== this.token || !this.playing || !buf) return;
        const now = this.deps.getProject().clips.find((x) => x.id === c.id);
        if (!now || keyOf(now) !== key) return;
        if (this.tl < now.at || this.tl >= clipEnd(now) || this.sounds.has(c.id)) return;
        const src = actx.createBufferSource();
        const gain = actx.createGain();
        gain.gain.value = now.volume;
        src.buffer = buf;
        src.connect(gain).connect(this.out());
        const offset = this.tl - now.at;
        if (offset < buf.duration) src.start(0, offset);
        this.sounds.set(c.id, { src, gain, key });
      });
    };
    for (const i of activeAt(clips, t)) startFor(clips[i]!);
    // sounds that start soon are rendered ahead of time
    for (const c of clips) if (c.at > t && c.at - t < 6) void (this.bakeable(c) && c.volume > 0 && bakedAudio(this.deps.getBlob(c.mediaId)!, c));
  }

  // ---------- transport ----------

  private stopPlaying(): void {
    this.stopSounds();
    if (this.playing) {
      this.playing = false;
      for (const pl of this.players) pl.video.pause();
      this.deps.onPlaying(false);
    }
  }

  pause(): void {
    this.token++;
    cancelAnimationFrame(this.raf);
    const was = this.playing;
    this.stopPlaying();
    if (was) {
      this.unsettle();
      this.settle();
    }
  }

  /** Pause and show the frame at timeline time t. */
  async showAt(t: number): Promise<void> {
    const tok = ++this.token;
    cancelAnimationFrame(this.raf);
    this.stopPlaying();
    this.unsettle();
    this.scrub = null;
    const clips = this.deps.getProject().clips;
    this.tl = Math.max(0, this.openEnd ? t : Math.min(t, totalOf(clips)));
    this.sync(this.tl, false);
    const seeks: Promise<void>[] = [];
    for (const i of activeAt(clips, this.tl)) {
      const clip = clips[i]!;
      const pl = this.players.find((x) => x.clipId === clip.id);
      if (pl && this.isVideo(clip)) seeks.push(this.seekPlayer(pl, sourceAt(clip, this.tl)));
    }
    this.draw();
    await Promise.all(seeks);
    if (tok !== this.token) return;
    this.draw();
    this.deps.onTime(this.tl);
    this.settle();
  }

  async play(): Promise<void> {
    this.fullOk = false;
    this.fullGen++;
    for (const [id, f] of [...this.full]) if (!this.deps.isBuilding(f.media)) this.full.delete(id); // the frames shown for videos that are still being prepared stay
    this.wakeAudio();
    const clips = this.deps.getProject().clips;
    if (clips.length === 0 && !this.openEnd) return;
    const total = totalOf(clips);
    if (!this.openEnd && this.tl >= total - 0.05) this.tl = 0;
    this.playFrom = this.tl;
    await this.showAt(this.tl);
    const tok = ++this.token;
    this.playing = true;
    this.deps.onPlaying(true);
    this.clockT0 = performance.now();
    this.clockTl0 = this.tl;
    this.loop(tok);
  }

  private loop(tok: number): void {
    this.raf = requestAnimationFrame(() => this.step(tok));
  }

  private step(tok: number): void {
    if (tok !== this.token || !this.playing) return;
    const total = totalOf(this.deps.getProject().clips);
    const tl = this.clockTl0 + (performance.now() - this.clockT0) / 1000;
    if (tl >= total && !this.openEnd) {
      const mode = this.deps.getEnd();
      this.tl = mode === 'pause' ? total : mode === 'return' ? Math.min(this.playFrom, total) : 0;
      this.stopPlaying();
      if (mode === 'pause') {
        this.draw();
        this.deps.onTime(this.tl);
      } else if (mode === 'loop') void this.play();
      else void this.showAt(this.tl);
      return;
    }
    this.tl = tl;
    this.sync(tl, true);
    this.syncSounds(tl, tok);
    this.draw();
    this.deps.onTime(tl);
    this.loop(tok);
  }

  // ---------- scrubbing by source time (trim handles and the trim bar) ----------

  private scrubTarget: { index: number; t: number; report: boolean } | null = null;
  private scrubbing = false;

  /**
   * Shows the frame at `srcT` (seconds in the source file) of clip `index`, without touching the
   * project. Rapid calls are merged: only the newest target is ever seeked to.
   */
  scrubSource(index: number, srcT: number, report: boolean): void {
    if (this.splitBusy && !this.fromSplit) return void (this.pendingScrub = { index, t: srcT, report });
    this.token++;
    cancelAnimationFrame(this.raf);
    this.stopPlaying();
    this.scrubTarget = { index, t: srcT, report };
    if (!this.scrubbing) void this.pumpScrub();
  }

  private async pumpScrub(): Promise<void> {
    this.scrubbing = true;
    try {
      while (this.scrubTarget) {
        const tg = this.scrubTarget;
        this.scrubTarget = null;
        const clips = this.deps.getProject().clips;
        const clip = clips[tg.index];
        if (!clip) continue;
        this.scrub = { index: tg.index, t: tg.t };
        if (this.isVideo(clip)) {
          const keep = new Set(activeAt(clips, this.tl).map((i) => clips[i]!.id));
          keep.add(clip.id);
          const pl = this.assign(clip, keep);
          if (pl) await this.seekPlayer(pl, Math.max(0, tg.t));
        }
        this.draw();
        if (tg.report) {
          this.tl = Math.min(totalOf(clips), clip.at + Math.max(0, (tg.t - clip.start) / clip.speed));
          this.deps.onTime(this.tl);
        }
      }
    } finally {
      this.scrubbing = false;
    }
  }
}
