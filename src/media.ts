import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { MediaInfo } from './types.ts';

export class UnsupportedMediaError extends Error {}

interface Entry {
  blob: Blob;
  url: string;
  thumbUrl: string;
  thumb: Blob | null;
  name: string;
  /** small copy of a video used only for the on-screen preview (never for export) */
  proxy: Blob | null;
  proxyUrl: string;
  bitmap: ImageBitmap | null;
  /** a smaller copy of a big picture for the preview (the export uses the full one) */
  preview: ImageBitmap | null;
}
const entries = new Map<string, Entry>();

export function registerMedia(id: string, blob: Blob, thumb: Blob | null, extra: { name?: string; proxy?: Blob | null; bitmap?: ImageBitmap | null } = {}): void {
  dropMedia(id);
  const proxy = extra.proxy ?? null;
  entries.set(id, {
    blob,
    url: URL.createObjectURL(blob),
    thumbUrl: thumb ? URL.createObjectURL(thumb) : '',
    thumb,
    name: extra.name ?? '',
    proxy,
    proxyUrl: proxy ? URL.createObjectURL(proxy) : '',
    bitmap: extra.bitmap ?? null,
    preview: null,
  });
  // a phone photo is 12 megapixels: drawing that every frame is what makes playback stutter, so the preview gets a smaller copy
  const bmp = extra.bitmap;
  if (bmp && Math.max(bmp.width, bmp.height) > PREVIEW_PX) {
    const k = PREVIEW_PX / Math.max(bmp.width, bmp.height);
    void createImageBitmap(bmp, { resizeWidth: Math.max(1, Math.round(bmp.width * k)), resizeHeight: Math.max(1, Math.round(bmp.height * k)), resizeQuality: 'high' })
      .then((small) => {
        const e = entries.get(id);
        if (e && e.bitmap === bmp) e.preview = small;
        else small.close();
      })
      .catch(() => undefined);
  }
}
let PREVIEW_PX = 360;
/** how big the picture drawn in the preview is for a photo (long side); set once at the start of the app */
export const setPhotoPreviewPx = (n: number): void => {
  PREVIEW_PX = n;
};

/** Attaches the small preview copy once it has been made. Returns false if the clip was removed meanwhile. */
export function setProxy(id: string, proxy: Blob): boolean {
  const e = entries.get(id);
  if (!e) return false;
  if (e.proxyUrl) URL.revokeObjectURL(e.proxyUrl);
  e.proxy = proxy;
  e.proxyUrl = URL.createObjectURL(proxy);
  return true;
}
/** Forgets the small preview copy. Returns true if there was a video that can get a new one. */
export function clearProxy(id: string): boolean {
  const e = entries.get(id);
  if (!e || e.bitmap) return false;
  if (e.proxyUrl) URL.revokeObjectURL(e.proxyUrl);
  e.proxy = null;
  e.proxyUrl = '';
  return true;
}
export const mediaEntry = (id: string): Entry | undefined => entries.get(id);
/** the first frame in grey, made once and remembered, with the canvas the skeleton is drawn on */
const frames = new Map<string, { gray: HTMLCanvasElement; skeleton: HTMLCanvasElement } | 'wait'>();
const WAVE_MS = 1700;
/**
 * The picture shown in place of a video while its preview copy is made: its first frame in grey and dimmed, with a wave of
 * light that grows from the middle outwards like a ring and starts again (a loading skeleton). `now` is the time in ms.
 */
/** the first frame in full colour (stands in for a video whose preview copy is still being made) */
export const mediaThumbCanvas = (id: string): HTMLCanvasElement | undefined => {
  const f = frames.get(id);
  return f && f !== 'wait' ? f.gray : undefined;
};
export function mediaSkeleton(id: string, now: number, ready: () => void): HTMLCanvasElement | undefined {
  const f = frames.get(id);
  if (f === 'wait') return undefined;
  if (f) {
    const c = f.skeleton;
    const x = c.getContext('2d')!;
    const w = c.width;
    const h = c.height;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, w, h);
    const reach = Math.hypot(w, h) / 2;
    const ph = (now % WAVE_MS) / WAVE_MS;
    const r = ph * (reach + reach * 0.5);
    const band = reach * 0.45;
    const g = x.createRadialGradient(w / 2, h / 2, Math.max(0, r - band), w / 2, h / 2, r + band);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${0.32 * (1 - ph * 0.6)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.globalCompositeOperation = 'lighter';
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'source-over';
    return c;
  }
  const e = entries.get(id);
  if (!e?.thumb) return undefined;
  frames.set(id, 'wait');
  void createImageBitmap(e.thumb)
    .then((bm) => {
      const make = () => {
        const c = document.createElement('canvas');
        c.width = bm.width;
        c.height = bm.height;
        return c;
      };
      const gray = make();
      const x = gray.getContext('2d')!;
      x.drawImage(bm, 0, 0);
      const skeleton = make();
      bm.close();
      if (entries.get(id) === e) frames.set(id, { gray, skeleton });
      else frames.delete(id);
    })
    .then(() => frames.has(id) && ready())
    .catch(() => frames.delete(id));
  return undefined;
}
export const mediaPreviewBitmap = (id: string): ImageBitmap | undefined => entries.get(id)?.preview ?? entries.get(id)?.bitmap ?? undefined;
export const mediaBitmap = (id: string): ImageBitmap | undefined => entries.get(id)?.bitmap ?? undefined;

export function dropMedia(id: string): void {
  frames.delete(id);
  const e = entries.get(id);
  if (!e) return;
  e.preview?.close();
  URL.revokeObjectURL(e.url);
  if (e.proxyUrl) URL.revokeObjectURL(e.proxyUrl);
  e.bitmap?.close();
  if (e.thumbUrl) URL.revokeObjectURL(e.thumbUrl);
  entries.delete(id);
}

export function dropAllMedia(): void {
  [...entries.keys()].forEach(dropMedia);
}

export const mediaBlob = (id: string): Blob | undefined => entries.get(id)?.blob;
/** What the preview plays: the small copy when it exists, else the original. */
export const mediaUrl = (id: string): string | undefined => entries.get(id)?.proxyUrl || entries.get(id)?.url;
export const thumbUrl = (id: string): string | undefined => entries.get(id)?.thumbUrl || undefined;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const newId = uid;

/** Reads duration, size and sound info, and grabs a first-frame thumbnail. */
export async function probeVideo(file: File, id: string): Promise<{ info: MediaInfo; thumb: Blob | null }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new UnsupportedMediaError(`"${file.name}" has no video in it.`);
    if (!(await vt.canDecode())) {
      throw new UnsupportedMediaError(`This device can't read the video format of "${file.name}".`);
    }
    const duration = await input.computeDuration();
    const width = await vt.getDisplayWidth();
    const height = await vt.getDisplayHeight();
    if (!(duration > 0) || !width || !height) throw new UnsupportedMediaError(`"${file.name}" looks empty or damaged.`);

    const at = await input.getPrimaryAudioTrack();
    const hasAudio = !!at && (await at.canDecode());

    let thumb: Blob | null = null;
    try {
      const scale = Math.min(1, 240 / Math.max(width, height));
      const sink = new CanvasSink(vt, { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)), fit: 'fill' });
      const first = await sink.getCanvas(await vt.getFirstTimestamp());
      if (first) thumb = await canvasToJpeg(first.canvas);
    } catch {
      thumb = null; // no thumbnail is fine
    }
    return { info: { id, name: file.name.replace(/\.[^.]+$/, ''), duration, width, height, hasAudio }, thumb };
  } finally {
    input.dispose();
  }
}

async function canvasToJpeg(c: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
  if (c instanceof OffscreenCanvas) return c.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
}

export const IMAGE_MAX_SECONDS = 3600;
export const IMAGE_DEFAULT_SECONDS = 5;

export const isAudioFile = (f: File): boolean => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|caf|aiff?)$/i.test(f.name);

export const isImageFile = (f: File): boolean => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name);

/** Decodes a still picture (upright, large ones scaled down to at most 4096 px). */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  let bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const big = Math.max(bmp.width, bmp.height);
  if (big > 4096) {
    const k = 4096 / big;
    const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
    bmp.close();
    bmp = small;
  }
  return bmp;
}

export async function probeImage(file: File, id: string): Promise<{ info: MediaInfo; thumb: Blob | null; bitmap: ImageBitmap }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeImage(file);
  } catch {
    throw new UnsupportedMediaError(`This device can't read the picture "${file.name}".`);
  }
  let thumb: Blob | null = null;
  try {
    const k = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(bitmap.width * k));
    c.height = Math.max(2, Math.round(bitmap.height * k));
    c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
    thumb = await canvasToJpeg(c);
  } catch {
    thumb = null;
  }
  return { info: { id, name: file.name.replace(/\.[^.]+$/, ''), duration: IMAGE_MAX_SECONDS, width: bitmap.width, height: bitmap.height, hasAudio: false, kind: 'image' }, thumb, bitmap };
}

/** A sound file: no picture, a duration. */
export async function probeAudio(file: File, id: string): Promise<{ info: MediaInfo; thumb: Blob | null }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const at = await input.getPrimaryAudioTrack();
    if (!at || !(await at.canDecode())) throw new UnsupportedMediaError(`This device can't read the sound of "${file.name}".`);
    const duration = await input.computeDuration();
    if (!(duration > 0)) throw new UnsupportedMediaError(`"${file.name}" looks empty or damaged.`);
    return { info: { id, name: file.name.replace(/\.[^.]+$/, ''), duration, width: 0, height: 0, hasAudio: true, kind: 'audio' }, thumb: null };
  } finally {
    input.dispose();
  }
}
