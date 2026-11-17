import { useState } from 'preact/hooks';
import { browserInfo, checkSupport } from '../support.ts';
import { Collapse } from './Fold.tsx';
import { Sheet } from './Sheet.tsx';

/** The manual. */
export function HelpSheet({ onClose }: { onClose: () => void }) {
  // one section open at a time: opening another folds the first
  const [openT, setOpenT] = useState<string | null>(null);
  const at = (t: string) => ({ open: openT === t, onToggle: () => setOpenT(openT === t ? null : t) });
  return (
    <Sheet title="Help" onClose={onClose}>
      <Collapse title="Timeline" {...at("Timeline")}>
        <p>Every clip is a strip on a lane, and every lane takes any kind of clip. Lane 0 is where things start; higher lanes draw on top, lower lanes underneath, and two empty lanes are always open beyond the last one in use. The yellow line is fixed: scroll the timeline under it to move through the video, and pinch to zoom. The darker areas before 0 and after the last clip are outside the video.</p>
      </Collapse>
      <Collapse title="Strips and gaps" {...at("Strips and gaps")}>
        <p>Tap a strip to select it. Tap it again to show its trim handles (drag them to trim), and once more to hide them, which makes short strips easy to move. Press and hold a strip until it lifts, then drag it in time or to another lane; it snaps to its neighbors, and if you drop it on top of another strip it moves to the next free lane. Tap empty space between two strips to pick the gap (dark red); tap its trash can to close it. Everything after it moves earlier, and anything that would then collide hops to the next free lane.</p>
      </Collapse>
      <Collapse title="Tabs" {...at("Tabs")}>
        <p>The tabs under the timeline raise a drawer over the lower part of the timeline. Tap the open tab again, or anywhere outside the drawer, to put it away. Video: Speed, Sound, Look, Clip. Text: Text, Color, Font, Outline, Look, Clip. Look has opacity, brightness, contrast, color and warmth. Tap a slider's name twice to reset it. Clip has split, duplicate and delete.</p>
      </Collapse>
      <Collapse title="Place the picture on the canvas" {...at("Place the picture on the canvas")}>
        <p>Touch the preview. One finger moves the clip. Two fingers pinch to zoom and twist to turn it. Hold still for a moment and it moves ten times slower, for exact placement. It snaps to the middle, the frame edges, quarter turns, "fits the whole frame", "fills the frame", and to the sides and middles of the other pictures. Double-tap to switch between fit and fill. A picture can be dragged until only a tenth of it is left in the frame.</p>
        <p>Drag a picture with one finger until the finger rests (a moment) on the middle of a side of the canvas to snap it to that half, or on a corner to snap it to that quarter. A ghost shows where it will go; lift the finger to apply. Half and quarter snaps always fill the area and crop what sticks out.</p>
      </Collapse>
      <Collapse title="Select mode and edit mode" {...at("Select mode and edit mode")}>
        <p>Tap a picture to select it: its box appears (select mode). All the handles scale it evenly, and the round handle on top turns it. Tap the picture again for edit mode (the box and the strip turn red): the handles now crop, and moving or pinching the picture moves it behind a frame that stays put, which is another way to crop. In the timeline, edit mode lets you drag the strip sideways to slide the picture inside it. Double-tap in edit mode to reset the crop and the placement.</p>
        <p>Hold a finger on empty canvas, or on another picture, then drag to draw a selection box: every picture it touches is picked, and picked pictures glow yellow.</p>
      </Collapse>
      <Collapse title="Fine control" {...at("Fine control")}>
        <p>Everything you drag has a precision mode, like the iPhone Photos app: hold your finger still anywhere along the drag for a moment and it switches to slow motion from that point. It glows while it is on.</p>
      </Collapse>
      <Collapse title="Add" {...at("Add")}>
        <p>Add asks where to put it first: after the last strip, on a new layer at the yellow line, or in place of the selected strip (only when exactly one strip is selected). Then pick what: Media (videos, pictures, sound), Text, Color or Clipboard (a picture, video or text you copied). Text appears at the yellow line for the default picture time, on the first free lane, and is edited in its tabs. Color is a flat color layer you pick in its Color tab, like a solid in After Effects. The handle under the preview can be dragged to give the preview or the timeline more room.</p>
      </Collapse>
      <Collapse title="Export" {...at("Export")}>
        <p>Pick quality and, if you want, split the video into parts of a fixed length. After exporting, use Share to send the files or save them to your gallery.</p>
      </Collapse>
      <Collapse title="About VideoWren" {...at("About VideoWren")}>
        <p>VideoWren is a mobile video editor that fits in your pocket: small, offline and free. It is made for phones; on a computer it only works at a basic level. It runs entirely on this device. Nothing is uploaded, there is no account and no watermark, and there are no trackers or analytics of any kind. Your videos never leave your phone.</p>
        <p>It was built by one person who was tired of 5 MB upload limits and 2 GB editors. The source is on GitHub (Andrematomer/videowren).</p>
      </Collapse>
      <Collapse title="About this device" {...at("About this device")}>
        <p>A tick means this browser has the feature; a cross means it does not. A cross on video decoding or encoding means the editor cannot work here (old iOS before 16.4, or a browser without WebCodecs, such as Firefox on some systems). A cross on audio means exports have no sound. A cross on saved project or offline use means the project is not remembered or the app needs a connection.</p>
        <ul class="checks">
          {checkSupport().rows.map((r) => (
            <li key={r.name} class={r.ok ? 'yes' : 'no'}>
              {r.ok ? '✓' : '✗'} {r.name}
              {!r.ok && <small> {r.missing}</small>}
            </li>
          ))}
        </ul>
        <p class="hint small-print">{browserInfo()}</p>
      </Collapse>
    </Sheet>
  );
}
