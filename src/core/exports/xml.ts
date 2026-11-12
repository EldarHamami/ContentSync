/** Escape text for XML element content and attribute values (newlines kept as references). */
export function esc(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '&#10;')
    .replace(/\t/g, '&#9;');
}

/** file://localhost/ URL for a folder + file name, percent-encoded the way Premiere writes it. */
export function fileUrl(folder: string, fileName: string): string {
  const parts = folder
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p.length > 0);
  parts.push(fileName);
  return 'file://localhost/' + parts.map((p) => encodeURIComponent(p).replace(/%3A/g, '%3a')).join('/');
}

export function safeFileName(s: string): string {
  const cleaned = s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 80) || 'ContentSync';
}
