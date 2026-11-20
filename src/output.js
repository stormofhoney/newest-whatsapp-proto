// Shared output helpers — tiny ANSI colors, byte formatting, sha256.

import { createHash } from 'node:crypto';

export const useColor = process.stdout.isTTY && !process.argv.includes('--no-color');

const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[39m` : String(s));

export const c = {
  dim: wrap('2'),
  bold: wrap('1'),
  green: wrap('32'),
  yellow: wrap('33'),
  red: wrap('31'),
  cyan: wrap('36'),
};

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function kv(indent, key, value) {
  console.log(`${' '.repeat(indent)}${c.dim(key.padEnd(14))}${value}`);
}

export function isJsonMode(flags) {
  return Boolean(flags.json);
}
