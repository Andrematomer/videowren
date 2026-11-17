import { useState } from 'preact/hooks';
import { discardProject, optimizeWithFeedback, useStore } from '../store.ts';
import { Sheet } from './Sheet.tsx';

/** Two tools for the whole timeline: simplify it, or delete the project. */
export function TimelineSheet({ onClose }: { onClose: () => void }) {
  const hasProject = useStore((s) => s.project.clips.length > 0);
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet title="Timeline" onClose={onClose}>
      <div class="col">
        <button class="btn" onClick={optimizeWithFeedback} disabled={!hasProject}>
          Simplify timeline
        </button>
        {!confirm ? (
          <button class="btn danger" disabled={!hasProject} onClick={() => setConfirm(true)}>
            Delete project
          </button>
        ) : (
          <>
            <p class="warn">This deletes every strip and the original videos stored on this device. It cannot be undone. Are you sure?</p>
            <div class="row">
              <button
                class="btn danger"
                onClick={async () => {
                  await discardProject();
                  onClose();
                }}
              >
                Yes, delete project
              </button>
              <button class="btn" onClick={() => setConfirm(false)}>
                Keep it
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
