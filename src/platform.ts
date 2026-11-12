// Browser capabilities: file picking, saving, keeping the screen awake, tap feedback.
import { fileReader, extractSonyXmlFromMp4 } from './core/mp4';
import { parseSonyXml } from './core/sony';
import type { Clip } from './core/types';
import { buildZip } from './core/exports/zip';
import type { ExportFile } from './core/exports';

type AnyWindow = Window & {
  showDirectoryPicker?: (o?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<any>;
};
const w = window as AnyWindow;

export const canPickFolder = typeof w.showDirectoryPicker === 'function';

/** iOS / iPadOS: saving goes through the share sheet ("Save to Files"). */
export const isAppleTouch =
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone =
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export interface ImportResult {
  clips: Clip[];
  skipped: { name: string; reason: string }[];
}

interface Source {
  name: string;
  file: () => Promise<File>;
}

async function readSources(sources: Source[], cameraId: string): Promise<ImportResult> {
  const out: ImportResult = { clips: [], skipped: [] };
  const sidecars = new Set(sources.filter((s) => /M\d{2}\.xml$/i.test(s.name)).map((s) => s.name.replace(/M\d{2}\.xml$/i, '').toUpperCase()));
  for (const s of sources) {
    const isXml = /\.xml$/i.test(s.name);
    const isMp4 = /\.(mp4|mxf|mov)$/i.test(s.name);
    if (!isXml && !isMp4) continue;
    // Skip proxies and media that already has its sidecar in the same selection.
    if (isMp4 && (/S\d{2}\.mp4$/i.test(s.name) || sidecars.has(s.name.replace(/\.[^.]+$/, '').toUpperCase()))) continue;
    if (isXml && !/M\d{2}\.xml$/i.test(s.name)) continue;
    try {
      const file = await s.file();
      const xml = isXml ? await file.text() : await extractSonyXmlFromMp4(fileReader(file));
      if (!xml) {
        out.skipped.push({ name: s.name, reason: 'no Sony clip information found in this file' });
        continue;
      }
      out.clips.push(parseSonyXml(xml, s.name, cameraId));
    } catch (e) {
      out.skipped.push({ name: s.name, reason: e instanceof Error ? e.message : 'could not be read' });
    }
  }
  return out;
}

export function importFromFiles(files: File[], cameraId: string): Promise<ImportResult> {
  return readSources(files.map((f) => ({ name: f.name, file: async () => f })), cameraId);
}

/** Let the user pick the card (or any folder); finds the clip sidecars anywhere below it. */
export async function importFromFolder(cameraId: string): Promise<ImportResult | null> {
  let dir: any;
  try {
    dir = await w.showDirectoryPicker!({ mode: 'read', id: 'contentsync-card' });
  } catch {
    return null;
  }
  const sources: Source[] = [];
  const walk = async (d: any, depth: number) => {
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'directory') {
        if (depth < 6 && !/^(SUB|THMBNL|GENERAL|\..*)$/i.test(name)) await walk(h, depth + 1);
      } else if (/\.(xml|mp4)$/i.test(name)) {
        sources.push({ name, file: () => h.getFile() });
      }
    }
  };
  await walk(dir, 0);
  return readSources(sources, cameraId);
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/** Save one file: share sheet on iPhone/iPad (choose "Save to Files"), download elsewhere. */
export async function saveFile(f: ExportFile): Promise<void> {
  const blob = new Blob([f.text], { type: f.mime });
  if (isAppleTouch && navigator.canShare) {
    const file = new File([blob], f.name, { type: f.mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
  }
  download(blob, f.name);
}

export async function saveZip(files: ExportFile[], name: string): Promise<void> {
  const blob = new Blob([buildZip(files) as BlobPart], { type: 'application/zip' });
  if (isAppleTouch && navigator.canShare) {
    const file = new File([blob], name, { type: 'application/zip' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
  }
  download(blob, name);
}

/** Write every file into a "ContentSync" folder inside a folder the user picks (e.g. the SD card). */
export async function saveToFolder(files: ExportFile[], sub: string): Promise<string | null> {
  let dir: any;
  try {
    dir = await w.showDirectoryPicker!({ mode: 'readwrite', id: 'contentsync-export' });
  } catch {
    return null;
  }
  const root = await dir.getDirectoryHandle('ContentSync', { create: true });
  const target = await root.getDirectoryHandle(sub, { create: true });
  for (const f of files) {
    const h = await target.getFileHandle(f.name, { create: true });
    const wr = await h.createWritable();
    try {
      await wr.write(f.text);
      await wr.close();
    } catch (e) {
      await wr.abort?.();
      throw e;
    }
  }
  return `${dir.name}/ContentSync/${sub}`;
}

let lock: any = null;
export async function keepAwake(on: boolean): Promise<boolean> {
  try {
    if (!on) {
      await lock?.release();
      lock = null;
      return false;
    }
    if (!('wakeLock' in navigator)) return false;
    lock = await (navigator as any).wakeLock.request('screen');
    return true;
  } catch {
    return false;
  }
}

export function buzz(): void {
  try {
    navigator.vibrate?.(20);
  } catch {
    /* unsupported */
  }
}

export function askPersistence(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* unsupported */
  }
}
