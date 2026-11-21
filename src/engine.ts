import { mediaBlob, mediaGray, mediaPreviewBitmap, mediaUrl } from './media.ts';
import { PreviewEngine } from './preview.ts';
import { onBakeChange, progress } from './bake.ts';
import { getState, set } from './store.ts';

/** The single preview player shared by the whole UI. */
export const engine = new PreviewEngine({
  getProject: () => getState().project,
  getUrl: mediaUrl,
  getImage: mediaPreviewBitmap,
  isBuilding: (id) => getState().proxyProgress[id] !== undefined,
  getGray: (id) => mediaGray(id, () => engine.draw()),
  getBlob: mediaBlob,
  onTime: (t) => set({ playhead: t }),
  onPlaying: (playing) => set({ playing }),
  getEnd: () => getState().prefs.onEnd,
});


onBakeChange(() => set({ bakeProgress: Object.fromEntries(progress) }));

// a preview copy started or finished: the video must be (not be) played from now on
window.addEventListener('pc-proxy', () => {
  if (!engine.playing) void engine.showAt(engine.tl);
});
