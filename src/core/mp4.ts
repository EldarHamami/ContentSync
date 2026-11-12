// Pull the embedded Sony metadata XML out of an MP4 without reading the whole file.
// Layout: ftyp, uuid, free, mdat, moov, meta(hdlr 'nrtm', 'xml ' ...). We walk top-level box
// headers with small slices, so a multi-gigabyte clip costs a few kilobytes of reads.

export interface SliceReader {
  size: number;
  read(start: number, end: number): Promise<Uint8Array>;
}

export function fileReader(file: Blob): SliceReader {
  return {
    size: file.size,
    read: async (s, e) => new Uint8Array(await file.slice(s, e).arrayBuffer()),
  };
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

const START = '<?xml';
const ROOT = '<NonRealTimeMeta';
const END = '</NonRealTimeMeta>';

function extract(bytes: Uint8Array): string | null {
  const text = new TextDecoder('utf-8').decode(bytes);
  const root = text.indexOf(ROOT);
  if (root < 0) return null;
  const end = text.indexOf(END, root);
  if (end < 0) return null;
  const decl = text.lastIndexOf(START, root);
  return text.slice(decl >= 0 && root - decl < 200 ? decl : root, end + END.length);
}

export async function extractSonyXmlFromMp4(r: SliceReader): Promise<string | null> {
  let pos = 0;
  for (let guard = 0; guard < 64 && pos + 8 <= r.size; guard++) {
    const head = await r.read(pos, Math.min(pos + 16, r.size));
    if (head.length < 8) break;
    let size = u32(head, 0);
    const type = fourcc(head, 4);
    if (size === 1) {
      if (head.length < 16) break;
      size = u32(head, 8) * 2 ** 32 + u32(head, 12);
    } else if (size === 0) {
      size = r.size - pos;
    }
    if (size < 8) break;
    if (type === 'meta') {
      // The box can also hold an embedded LUT; cap the read and search for the XML text.
      const cap = Math.min(size, 4 * 1024 * 1024);
      const found = extract(await r.read(pos, pos + cap));
      if (found) return found;
    }
    pos += size;
  }
  // Fallback: scan the tail of the file.
  const tail = Math.min(r.size, 2 * 1024 * 1024);
  return extract(await r.read(r.size - tail, r.size));
}
