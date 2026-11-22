import { mediaBlob, mediaWipe, mediaPreviewBitmap, mediaUrl } from './media.ts';
import { PreviewEngine } from './preview.ts';
import { onBakeChange, progress } from './bake.ts';
import { getState, set } from './store.ts';

/** The single preview player shared by the whole UI. */
export const engine = new PreviewEngine({
  getProject: () => getState().project,
  getUrl: mediaUrl,
  getImage: mediaPreviewBitmap,
  isBuilding: (id) => getState().proxyProgress[id] !== undefined,
  getGray: (id) => mediaWipe(id, getState().proxyProgress[id] ?? 0, () => engine.draw()),
  getBlob: mediaBlob,
  onTime: (t) => set({ playhead: t }),
  onPlaying: (playing) => set({ playing }),
  getEnd: () => getState().prefs.onEnd,
});


onBakeChange(() => set({ bakeProgress: Object.fromEntries(progress) }));

// the wipe over a building video follows its progress
window.addEventListener('pc-proxy-tick', () => engine.draw());
// a preview copy started or finished: the video must be (not be) played from now on
window.addEventListener('pc-proxy', () => {
  if (!engine.playing) void engine.showAt(engine.tl);
});
