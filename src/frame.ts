import { FriendlyError, exportFrame } from './exporter.ts';
import { saveBlob, shareFiles } from './files.ts';
import { engine } from './engine.ts';
import { say } from './hud.ts';
import { blobFor, getState } from './store.ts';
import { fmtTime } from './timeline.ts';

let busy = false;

/** Saves the picture on screen at the yellow line as a PNG (at most 1080p): the share sheet on phones, a download on computers. */
export async function saveFrame(): Promise<void> {
  if (busy) return;
  busy = true;
  say('Making the picture…', 8000);
  let small = false;
  try {
    const st = getState();
    let blob: Blob | null = null;
    try {
      blob = await exportFrame(st.project, (id) => blobFor(id), st.playhead);
    } catch (e) {
      // the full-size picture could not be made on this device: the picture as it is on screen is better than nothing
      console.error(e);
      blob = await engine.snapshot();
      small = true;
      if (!blob) throw e;
    }
    const base = (st.project.name || 'frame').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40);
    const name = `${base}_${fmtTime(st.playhead, 1).replace(/[^0-9]/g, '')}.png`;
    const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const r = phone ? await shareFiles([{ name, blob }], 'image/png') : 'unsupported';
    if (r === 'unsupported') saveBlob(name, blob);
    say(r === 'cancelled' ? 'Cancelled' : small ? 'Picture saved (preview size)' : 'Picture saved');
  } catch (e) {
    console.error(e);
    say(e instanceof FriendlyError ? e.message : `Could not make the picture${e instanceof Error && e.message ? ` (${e.message.slice(0, 60)})` : ''}`, 4000);
  } finally {
    busy = false;
  }
}
