import type { Project } from './types.ts';

/**
 * Autosave of the last project (JSON + the original video files) in IndexedDB.
 * It stays until the user deletes it. Everything is best-effort: if storage is blocked or full the
 * editor keeps working, it just won't remember anything.
 */
const DB = 'pocket-cut-nla'; // its own database: this experimental build must not touch the saved project of the normal app

export interface SavedMedia {
  blob: Blob;
  name: string;
  thumb: Blob | null;
  /** small preview copy of a video, if it was made */
  proxy?: Blob | null;
  /** the long side the copy was made at */
  proxyLong?: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('media');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const wrap = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export async function saveMedia(id: string, m: SavedMedia): Promise<boolean> {
  try {
    const db = await open();
    const tx = db.transaction('media', 'readwrite');
    tx.objectStore('media').put(m, id);
    await done(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Saves the project JSON and drops stored media the project no longer uses. */
export async function saveProject(p: Project, keep: Set<string> = new Set()): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(['kv', 'media'], 'readwrite');
    tx.objectStore('kv').put(p, 'project');
    const used = new Set([...p.clips.map((c) => c.mediaId), ...keep]);
    const media = tx.objectStore('media');
    const keys = await wrap(media.getAllKeys());
    for (const k of keys) if (!used.has(String(k))) media.delete(k);
    await done(tx);
    db.close();
  } catch {
    /* ignore */
  }
}

export async function loadSaved(): Promise<{ project: Project; media: Map<string, SavedMedia> } | null> {
  try {
    const db = await open();
    const project = (await wrap(db.transaction('kv').objectStore('kv').get('project'))) as Project | undefined;
    if (!project || project.version !== 1 || !Array.isArray(project.clips)) {
      db.close();
      return null;
    }
    const keys = await wrap(db.transaction('media').objectStore('media').getAllKeys());
    const media = new Map<string, SavedMedia>();
    // one read for each file, each in a transaction of its own: a file that can not be read loses only itself, not the whole project
    for (const key of keys) {
      try {
        const m = (await wrap(db.transaction('media').objectStore('media').get(key))) as SavedMedia | undefined;
        if (m?.blob) media.set(String(key), m);
      } catch (e) {
        console.warn('a stored file could not be read', e);
      }
    }
    db.close();
    return { project, media };
  } catch (e) {
    console.warn('the saved project could not be read', e);
    return null;
  }
}

/** true when something is saved (used to tell "nothing saved" from "saved but could not be read") */
export async function hasSaved(): Promise<boolean> {
  try {
    const db = await open();
    const n = await wrap(db.transaction('kv').objectStore('kv').count());
    db.close();
    return n > 0;
  } catch {
    return false;
  }
}

export async function clearSaved(): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(['kv', 'media'], 'readwrite');
    tx.objectStore('kv').clear();
    tx.objectStore('media').clear();
    await done(tx);
    db.close();
  } catch {
    /* ignore */
  }
}

/** Asks the browser not to evict our data under storage pressure. Safe to call repeatedly. */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
