// Minimal tar reader — handles ustar headers, GNU long names ('L'),
// PAX extended headers ('x') and PAX globals ('g'). Zero dependencies.
// Returns a Map<path, Buffer> of regular files with a common root dir stripped.

function cstr(block, start, len) {
  const s = block.subarray(start, start + len);
  const nul = s.indexOf(0);
  return s.subarray(0, nul === -1 ? s.length : nul).toString('latin1');
}

function parseOctalStr(str) {
  const t = str.replace(/[\0 ]+$/g, '').replace(/^ +/g, '');
  if (!t) return 0;
  return parseInt(t, 8) || 0;
}

function parseSize(block) {
  const raw = block.subarray(124, 136);
  if (raw[0] & 0x80) {
    // GNU base-256 big number
    let v = 0n;
    for (let i = 0; i < 12; i++) {
      v = (v << 8n) | BigInt(i === 0 ? raw[i] & 0x7f : raw[i]);
    }
    return Number(v);
  }
  return parseOctalStr(cstr(block, 124, 12));
}

function isZeroBlock(block) {
  for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false;
  return true;
}

function verifyChecksum(block) {
  const stored = parseOctalStr(cstr(block, 148, 8));
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < 512; i++) {
    const b = i >= 148 && i < 156 ? 0x20 : block[i];
    unsigned += b;
    signed += b > 127 ? b - 256 : b;
  }
  return stored === unsigned || stored === signed;
}

function parsePax(data) {
  const out = {};
  const text = data.toString('latin1');
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    if (nl === -1) break;
    const line = text.slice(pos, nl + 1);
    const m = /^(\d+) ([^=]+)=(.*)\n$/.exec(line);
    if (!m) break;
    out[m[2]] = m[3];
    pos += parseInt(m[1], 10);
  }
  return out;
}

function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

function stripCommonRoot(files) {
  if (files.length === 0) return new Map();
  let root = null;
  for (const f of files) {
    const i = f.path.indexOf('/');
    if (i === -1) { root = null; break; }
    const c = f.path.slice(0, i);
    if (root === null) root = c;
    else if (root !== c) { root = null; break; }
  }
  const map = new Map();
  for (const f of files) {
    map.set(root && f.path.startsWith(root + '/') ? f.path.slice(root.length + 1) : f.path, f.data);
  }
  return map;
}

export function parseTar(buf) {
  const files = [];
  let off = 0;
  let longName = null; // pending GNU 'L' name
  let pax = null;      // pending PAX overrides

  while (off + 512 <= buf.length) {
    const block = buf.subarray(off, off + 512);
    if (isZeroBlock(block)) break;
    if (!verifyChecksum(block)) {
      throw new Error(`Corrupt tar header at offset ${off} (download truncated?)`);
    }
    const size = parseSize(block);
    const dataStart = off + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) {
      throw new Error('Truncated tar archive');
    }
    const data = buf.subarray(dataStart, dataEnd);
    const pad = size % 512 === 0 ? 0 : 512 - (size % 512);
    const nextOff = dataEnd + pad;

    const typeByte = String.fromCharCode(block[156]);
    const type = typeByte === '\0' || typeByte === ' ' ? '0' : typeByte;
    const magic = cstr(block, 257, 6);

    if (type === 'L') {
      longName = data.toString('latin1').replace(/\0+$/, '');
    } else if (type === 'x') {
      pax = parsePax(data);
    } else if (type === 'g') {
      // global PAX — git tarballs only carry a comment; nothing we need
    } else if (type === '0') {
      let name = cstr(block, 0, 100);
      if (magic === 'ustar' || magic === 'ustar ') {
        const prefix = cstr(block, 345, 155);
        if (prefix) name = prefix + '/' + name;
      }
      const path = pax?.path ?? longName ?? name;
      pax = null;
      longName = null;
      if (path) {
        files.push({ path: normalizePath(path), data: Buffer.from(data) });
      }
    }
    // everything else (dirs '5', symlinks '2', 'K', …) is skipped
    off = nextOff;
  }
  return stripCommonRoot(files);
}
