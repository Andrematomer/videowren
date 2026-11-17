export interface SupportRow {
  name: string;
  ok: boolean;
  /** what it means when missing */
  missing: string;
}

export interface Support {
  /** the editor can work at all */
  ok: boolean;
  rows: SupportRow[];
}

// testing aid: ?fake=VideoEncoder,indexedDB pretends those features are missing (a real unsupported device is hard to come by)
const fake = new Set((typeof location !== 'undefined' ? new URLSearchParams(location.search).get('fake') ?? '' : '').split(',').filter(Boolean));
const has = (name: string): boolean => !fake.has(name) && typeof (globalThis as Record<string, unknown>)[name] !== 'undefined';

/** Which browser features the editor relies on. Video decode + encode are required; the rest degrade. */
export function checkSupport(): Support {
  const rows: SupportRow[] = [
    { name: 'Video decoding', ok: has('VideoDecoder'), missing: 'Videos cannot be opened.' },
    { name: 'Video encoding', ok: has('VideoEncoder'), missing: 'Videos cannot be exported.' },
    { name: 'Audio decoding', ok: has('AudioDecoder'), missing: 'Exported videos will have no sound.' },
    { name: 'Audio encoding', ok: has('AudioEncoder'), missing: 'Exported videos will have no sound.' },
    { name: 'Saved project', ok: has('indexedDB'), missing: 'The project is not remembered after closing.' },
    { name: 'Offline use', ok: 'serviceWorker' in navigator && !fake.has('serviceWorker'), missing: 'The app needs a connection.' },
  ];
  return { ok: rows[0]!.ok && rows[1]!.ok && !fake.has('crash'), rows };
}

export const browserInfo = (): string => navigator.userAgent;

/** testing aid: ?fake=crash makes the app crash after "Proceed" so the crash screen can be seen */
export const fakeCrash = fake.has('crash');
