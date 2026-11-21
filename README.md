# VideoWren

<p align="center"><img src="public/icons/icon-192.png" width="128" alt="VideoWren"></p>

**A mobile video editor that fits in your pocket.** Small, offline, free, and no trackers or analytics.

Ever tried to send a video to Discord and been greeted by the **5 MB limit**? Or needed to cut ten
seconds out of a clip and ended up downloading a 2 GB video editor you will never open again? Or
wanted to post a long video as Stories, only to find it cut off at the wrong second?

VideoWren is the answer: a **multi-lane non-linear editor (NLE)** that fits on a phone and weighs next to nothing: stack videos,
pictures, text and sound on layers, place them freely in time, and export as one file or as several files of a
fixed length (for example 60-second parts for Instagram Stories).

Runs entirely in the browser. No account, no upload, no watermark, no ads, and no trackers or analytics: nothing about you or your videos ever leaves the device.

**Try it:** https://videowren.web.app/

It works as a normal web page. Installing it as an app is optional: that only adds offline use and
full-screen mode.

## Install on your phone (optional)

- **Android (Chrome):** the Install button on the welcome screen, or menu → Install app.
- **Computer (Chrome / Edge):** the install icon in the address bar, or the Install button on the welcome screen.
- **iPhone / iPad (Safari, Edge and other browsers that offer it):** Share → Add to Home Screen. If you use it often, do this rather than keeping a
  normal tab: Safari deletes the stored data of websites you haven't opened for 7 days, but as far as is
  known not that of Home Screen apps.

After the first visit it works with no connection.

## What it does

| | |
|---|---|
| Timeline | Lanes of strips; the yellow line is fixed and the timeline scrolls under it. Pinch to zoom. Higher lanes draw on top. Hold a strip to lift it, then drag it in time or to another lane; it snaps to the edges of its neighbors on any layer. Drag the handles of the selected strip to trim; hold still for fine control. In edit mode, dragging a video or sound strip slips its content inside the strip. Drag up or down on the timeline to zoom, sideways to seek; the line catches strip edges and marks every strip that has that edge. |
| Gaps | Tap empty space between strips to pick the gap (dark red), tap its trash can to remove it: everything after it moves earlier, and anything that would collide hops to the next free lane. |
| Tabs | With a clip selected: its tabs (Speed, Sound, Look, Text...) raise a drawer over the timeline. With nothing selected (tap an empty lane, a gap or the space around the canvas): Help, Canvas, Settings (with Delete project), Export. Every panel has a × to close it. |
| Middle bar | Play, Add (first where it goes: after the last strip of the whole timeline, on current time (files one after another from the yellow line, as one group that moves to the next free lane together if anything is in the way), as layers (all at the yellow line, each on its own lane), or in place of the selected strip; then Media, Text, Color or Clipboard. Replacing keeps the strip's look, effects, opacity, volume, position, crop and speed wherever they still apply), Delete, Undo, Redo, Split (the gap icon), Duplicate (the copy sits at the same time, one layer out). With nothing selected, Delete becomes Simplify timeline and Duplicate becomes Paste. The whole area after the dashed line is the pane divider: drag or flick it to trade height between preview and timeline. |
| Empty lanes | Tap an empty lane that lies between used lanes to pick it (dark red), tap it again to take it out: the strips on its far side (further from lane 0) move one lane closer. Simplify timeline (button in the middle bar when nothing is selected)  moves every strip as close to lane 0 as it can go without changing what covers what. |
| Split | The Split button cuts the selected strip at the yellow line, or every strip under the line when nothing is selected. |
| Several strips | Hold on empty space in the timeline (a gap too) or on the preview, even outside the canvas, until the box appears, then drag it over strips to pick them. Tap strips to add or remove them, or hold and box again to add more. A box around the picked strips on screen scales and turns them as a group, and so do one or two fingers on the preview. Tabs shared by all of them stay; sound, speed and look changes reach all, and dragging one moves all. |
| Full preview | Drag or flick the ⇕ area at the end of the middle bar down until less than one lane shows and release: the preview fills the screen with Delete, Undo, Redo, Duplicate and Exit. Dragging it up shrinks the preview to nothing. |
| Speed | A snapping slider from 0.25× to 4×. The voice keeps its pitch, or follows the speed if you prefer. |
| Effects | Vignette, blur, glow, sharpen, pixelate and color split, per clip, for video, pictures, text and color (needs WebGL). Every effect starts at 0 and is skipped entirely until raised. |
| Look | Opacity, brightness, contrast, color and warmth, per clip, for video and pictures (needs WebGL). |
| Place and crop | Drag, pinch and twist the clip on the preview, with snapping to the center, edges, quarter turns, "fits" and "fills"; up to 90% of it can leave the frame. Tap once for a transform box (scale, turn, crop); tapping the picture or any of the box's handles switches between select and edit mode, which helps when a small picture is covered by its own handles. |
| Text | Several fonts and colors; the next text starts from the last style you used. Text is a picture like any other. |
| Sound | Several sound lanes (mp3, m4a, wav), volume and mute per clip, and the sound of videos is mixed in. |
| Canvas | Pick it before adding anything: the empty canvas is drawn. Ratio (9:16, 4:5, 1:1, 5:4 or 16:9) and a background color. |
| Export | MP4, 360p / 480p / 720p / 1080p, 24 / 30 / 60 fps, Low / Balanced / High presets or a bitrate on a log slider (0.25 to 16 Mbps, an average target), optional split into equal or fixed-length parts. Your last export settings are remembered. |
| Drag and drop | Drag files onto the editor, even into an empty project. Over a timeline lane, the lane lights up and the files follow one another on it; hold on the top or bottom lane to open more lanes. Over the preview area (the whole area, not just the canvas, and in full preview too) they land on the yellow line, each on its own layer. |
| Feedback | A capsule above your fingers names what you are doing. On Android, short vibrations confirm holds, double taps and snaps (Settings → Vibration; iPhone browsers have no vibration API). |
| Keyboard | Ctrl+Z undo, Ctrl+Y or Ctrl+Shift+Z redo, Space play, S split, Ctrl+D duplicate, Ctrl+A select (press again: every strip, again: back to the strips under the yellow line), F full preview, Delete remove, Ctrl+V (Cmd+V) paste a copied picture, video, sound or text on current time. Hardware keyboards on tablets and phones send the same keys. A mouse drags and zooms the timeline like a finger. |

Your last project (with the original videos) is kept on the device until you delete it in the Timeline panel.

## Known limits

- It needs a browser with WebCodecs (Chrome / Edge / Android Chrome, Safari 16.4 or newer). Other browsers can't
  open or export videos. **Help** shows what your device supports.
- Sound needs audio decoding and encoding in the browser. Some browsers (older Safari versions in particular)
  lack them, and then exported videos have no sound. The export screen tells you when that happens.
- The codecs depend on the device. It uses H.264 + AAC when available and says so when it has to fall back.
- Exporting runs on the main thread: keep the screen on and the app open until it finishes. Long 1080p exports are slow on old phones.
- Each output part is held in memory while it is written, so very long parts at 1080p / 60 fps can run out of memory on low-end phones. Shorter parts help.
- A web app can't run while it is closed, so the saved project is never cleaned up automatically. Use Delete project in the Timeline panel.
- Big videos also get a small, light copy (144 to 360 px, set in Settings) made in the background, only for the on-screen preview. Export always reads your original file.
- At speeds other than 1× the preview plays the clip's sound from a separate, pre-rendered copy (a moment after you press play), because phones often mute video sound at unusual speeds.
- On iPhone the preview volume may not follow the Sound slider (the browser limits it); the export always does. The lock screen may show a bare player while a preview plays; a web page cannot fully switch that off.
- The preview pauses briefly between two different source files. The exported video has no gap.

## Develop

```
npm install
npm run dev      # dev server (no offline cache in dev)
npm test         # unit tests: placement, rotation, splitting, bitrate, pitch-preserving speed
npm run build    # type-check + production build into dist/, including the service worker
```

Preact + TypeScript + Vite. Decoding and encoding use WebCodecs through [Mediabunny](https://mediabunny.dev) (MPL-2.0).
Pushes to `main` deploy to Firebase Hosting through `.github/workflows/firebase-hosting-merge.yml`.
The icon is `public/icons/icon.svg`; `node scripts/make-icons.cjs` redraws the PNG sizes (needs Playwright).

The export approach (WebCodecs, Mediabunny, canvas rendering) comes from the author's Win-Movie-Faker project.

## License

MIT. See [LICENSE](LICENSE).
