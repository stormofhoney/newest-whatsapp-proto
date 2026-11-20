import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTar } from '../src/tar.js';

/** Build a real tar archive with the system `tar` (ustar + pax path, >100 chars). */
function makeTar(dir, files) {
  for (const [name, content] of files) {
    const p = join(dir, name);
    execSync(`mkdir -p "${join(dir, name.split('/').slice(0, -1).join('/'))}"`);
    writeFileSync(p, content);
  }
  execSync(`tar -cf "${join(dir, 'out.tar')}" -C "${dir}" ${files.map(([n]) => `"${n}"`).join(' ')}`);
  return readFileSync(join(dir, 'out.tar'));
}

import { writeFileSync } from 'node:fs';

test('parseTar: simple ustar archive via system tar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pf-tar-'));
  try {
    const buf = makeTar(dir, [
      ['Baileys-test/WAProto/WAProto.proto', Buffer.from('syntax = "proto3";\npackage proto;\n')],
      ['Baileys-test/WAProto/index.js', Buffer.from('export default {};\n')],
      ['Baileys-test/package.json', Buffer.from('{"name":"x"}')],
    ]);
    const files = parseTar(buf);
    assert.equal(files.size, 3);
    assert.ok(files.has('WAProto/WAProto.proto'));
    assert.ok(files.has('WAProto/index.js'));
    assert.equal(files.get('package.json').toString(), '{"name":"x"}');
    assert.equal(files.get('WAProto/index.js').toString(), 'export default {};\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseTar: strips common root dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pf-tar2-'));
  try {
    const buf = makeTar(dir, [['root-a/sub/f.txt', Buffer.from('hello')], ['root-a/g.txt', Buffer.from('x')]]);
    const files = parseTar(buf);
    assert.deepEqual([...files.keys()].sort(), ['g.txt', 'sub/f.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseTar: truncated archive throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pf-tar3-'));
  try {
    const buf = makeTar(dir, [['a/big.bin', Buffer.alloc(200000, 7)]]);
    assert.throws(() => parseTar(buf.subarray(0, 1000)), /Truncated|Corrupt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
