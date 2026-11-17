import type { ExportSettings } from './types.ts';

/** Target video bitrate limits (megabits per second) that the editor accepts. */
export const MIN_MBPS = 0.25;
export const MAX_MBPS = 16;

/** Sound: 96 kbps AAC is plenty for phone speakers and earbuds; richer files (3 Mbps video and up) get 128 kbps. */
export const audioBitrate = (videoBps: number): number => (videoBps >= 3_000_000 ? 128_000 : 96_000);

/**
 * Bits per pixel per frame for the three presets. They are tuned for what a phone screen can actually show:
 * 1 / 2 / 4 Mbps for 1080p at 30 fps (1920 x 1080 x 30 = 62.2 million pixels per second), scaled with size and frame rate.
 * Estimates, not strict limits.
 */
const BITS_PER_PIXEL = { small: 1_000_000 / 62_208_000, medium: 2_000_000 / 62_208_000, high: 4_000_000 / 62_208_000 } as const;

/** Marks on the bitrate slider (Mbps), equally far apart (the slider is logarithmic). They do not snap. */
export const RATE_STOPS = [0.25, 0.5, 1, 2, 4, 8, 16] as const;

export const clampMbps = (m: number): number => Math.min(MAX_MBPS, Math.max(MIN_MBPS, m));

/** The bitrate (bits per second) the quality preset gives for this picture size. */
export function autoBitrate(w: number, h: number, fps: number, quality: ExportSettings['quality']): number {
  return Math.max(250_000, Math.round(w * h * fps * BITS_PER_PIXEL[quality]));
}

/** The video bitrate in bits per second the export will ask the encoder for. */
export function videoBitrate(s: Pick<ExportSettings, 'bitrateMbps' | 'quality' | 'fps'>, w: number, h: number): number {
  if (s.bitrateMbps != null && Number.isFinite(s.bitrateMbps)) return Math.round(clampMbps(s.bitrateMbps) * 1_000_000);
  return autoBitrate(w, h, s.fps, s.quality);
}

/** Rough size of an exported part. Real files vary a little with the picture. */
export function estimateBytes(videoBps: number, seconds: number, withAudio: boolean): number {
  return Math.round(((videoBps + (withAudio ? audioBitrate(videoBps) : 0)) * seconds) / 8);
}

export const fmtMbps = (bps: number): string => {
  const m = bps / 1_000_000;
  return `${m >= 10 ? m.toFixed(0) : m < 1 ? m.toFixed(2).replace(/0$/, '') : m.toFixed(1).replace(/\.0$/, '')} Mbps`;
};
