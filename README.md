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
- **iPhone / iPad (Safari, Edge and other browsers that offer it):** Share, then Add to Home Screen (the Share command can sit inside a menu first, depending on the iOS version). If you use it often, do this rather than keeping a
  normal tab: Safari deletes the stored data of websites you haven't opened for 7 days, but as far as is
  known not that of Home Screen apps.

After the first visit it works with no connection.

## What it does

| | |
|---|---|
| Timeline | Lanes of strips; the yellow line is fixed and the timeline scrolls under it. Pinch to zoom (from a frame up to about ten minutes across the screen). Higher lanes draw on top. Hold a strip to lift it, then drag it in time or to another lane; it snaps to the edges of its neighbors on any layer. Drag the handles of the selected strip to trim; hold still for fine control. In edit mode, dragging a video or sound strip slips its content inside the strip. Drag up or down on the timeline to zoom, sideways to seek; the line catches strip edges and marks every strip that has that edge. |
| Gaps | Tap empty space between strips to pick the gap (dark red), tap its trash can to remove it: everything after it moves earlier, and anything that would collide hops to the next free lane. |
| Tabs | With a clip selected: its tabs (Speed, Sound, Look, Text...) raise a drawer over the timeline. With nothing selected (tap an empty lane, a gap or the space around the canvas): Import, Canvas, Settings (with Delete project), Export. Every panel has a × to close it. |
| Middle bar | Play, Delete, Undo, Redo, Split (the gap icon), Duplicate (the copy sits at the same time, one layer out). With nothing selected, Delete becomes Simplify timeline and Duplicate becomes Paste. The whole area after the dashed line is the pane divider: drag or flick it to trade height between preview and timeline. |
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
| Preview copies | Big videos get a small preview copy (Settings: Video preview quality, default 240p; Photo preview quality, default 360p). Both settings are used from the next start of the app, and every copy is made again then. While a copy is made, the video shows its first frame in grey with a light wave that keeps growing from the middle, and a note "generating preview NN%" that is as big as the picture and turns with it; it does not play until the copy is ready. Playing and moving pictures use the small copies; when the preview is paused and still for a moment, photos and videos are drawn from the full-size originals (video: one frame decoded from the original, at most 1920 px). Export always uses the originals. |
| Dropping files | Over a timeline lane, a yellow outline per file shows where it would land (it snaps to strip edges and the yellow line, like moving a strip); on release the first file starts there and the others follow, moving together to the next lane if anything is in the way. Over the preview, one outline per file is stacked on its own layer at the yellow line, and the timeline opens as many layers as needed until the finger leaves. Outlines are drawn 3 s long: the real length is only known after the files are read. |
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


## Import, recording, taps

- **Import tab** (first tab with nothing selected): Media, Text, Color, Clipboard. One item is placed at once; several wait as a pile of thumbnails (videos already get their preview copies) that is dragged onto the timeline or the preview; the outline shows the landing place and a yellow line joins it to the finger on touch screens.
- **Tapping a strip**: 1st tap selects (the yellow line glides to it), 2nd tap goes into edit mode and zooms the strip to the middle of the timeline, 3rd tap goes back to select mode and the earlier zoom (unless changed by hand). The picked picture in the preview toggles the mode in the same way. The button at the left of the middle bar is fit/fill. Seeking never deselects. No double-tap gestures are used (slider names reset with one tap).
- **Dropping files from outside** (Files, Photos, another window): they are let go anywhere on the page and wait in the Import tab as a card, to be dragged to a place there.
- Pictures, colors and texts can be made longer to the left in edit mode; a finger at the edge of the timeline scrolls it while an edge, or the Import card, is dragged.
- **Volume** goes from 0 to 400 %.
- While a video's preview copy is being made, the current frame is decoded at preview size (the copy pauses meanwhile), the last frame stays while seeking, and the moving light and note stay on top.

## Recording with the mic toggle
With nothing selected the button at the left of the middle bar is a mic. Tap: record at once while the timeline plays (playback is muted); tap again: stop. The middle bar shows Recording and the length of the take, the bottom bar the microphone level, and all other fingers are ignored meanwhile. Pause/Play pause and resume the same take; seeking ends it.

## Replace tab
Selecting a strip adds **Replace** as the first bottom tab: pick one media file, text, colour, clipboard item or a recording and it takes the place of the strip, keeping its position, length (where possible) and look.
