import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildExports } from '../src/core/exports';
import type { Session } from '../src/core/types';
import { demo } from './exports.test';

// Set SAMPLES_OUT=<dir> to write sample exports for validation against the Apple DTDs.
it.runIf(!!process.env.SAMPLES_OUT)('writes sample exports', () => {
  const variants: [string, Session][] = [
    ['25', demo()],
    ['5994', demo('59.94p', 30, true, '43114805')],
    ['2398', demo('23.98p', 24, false, '00535300')],
    ['50', demo('50p', 25, true, '15570212')],
  ];
  for (const [n, s] of variants)
    for (const f of buildExports(s)) if (f.kind !== 'readme') writeFileSync(`${process.env.SAMPLES_OUT}/${n}-${f.kind}.${f.name.split('.').pop()}`, f.text);
});
