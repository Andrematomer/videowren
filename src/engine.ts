import { mediaBitmap, mediaBlob, mediaEntry, mediaSkeleton, mediaPreviewBitmap, mediaUrl } from './media.ts';
import { PreviewEngine } from './preview.ts';
import { onBakeChange, progress } from './bake.ts';
import { getState, set } from './store.ts';
import { activeAt } from './timeline.ts';

/** The single preview player shared by the whole UI. */
export const engine = new PreviewEngine({
  getProject: () => getState().project,
  getUrl: mediaUrl,
  getImage: mediaPreviewBitmap,
  getFullImage: mediaBitmap,
  hasProxy: (id) => !!mediaEntry(id)?.proxy,
  isBuilding: (id) => getState().proxyProgress[id] !== undefined,
  getGray: (id) => mediaSkeleton(id, performance.now(), () => engine.draw()),
  getBlob: mediaBlob,
  onTime: (t) => set({ playhead: t }),
  onPlaying: (playing) => set({ playing }),
  getEnd: () => getState().prefs.onEnd,
});


onBakeChange(() => set({ bakeProgress: Object.fromEntries(progress) }));

// the wipe over a building video follows its progress
// the skeleton of a building video is animated: a frame every refresh while one is on screen and the preview is not playing
let skeletonLoop = 0;
const skeletonTick = () => {
  skeletonLoop = 0;
  if (engine.playing) return;
  const st = getState();
  const on = activeAt(st.project.clips, engine.tl).some((i) => st.proxyProgress[st.project.clips[i]!.mediaId] !== undefined && !engine.hasFullFrame(st.project.clips[i]!.id) && !['image', 'audio'].includes(st.project.media[st.project.clips[i]!.mediaId]?.kind ?? ''));
  if (!on) return;
  engine.draw();
  skeletonLoop = requestAnimationFrame(skeletonTick);
};
const startSkeleton = () => {
  if (!skeletonLoop) skeletonLoop = requestAnimationFrame(skeletonTick);
};
window.addEventListener('pc-proxy-tick', startSkeleton);
window.addEventListener('pc-proxy', startSkeleton);

// a preview copy started or finished: the video must be (not be) played from now on
window.addEventListener('pc-proxy', () => {
  if (!engine.playing) void engine.showAt(engine.tl);
});
