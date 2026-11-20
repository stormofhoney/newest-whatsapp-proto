// proto-fetcher get — download WAProto.proto (+ artifacts) for a given ref.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchBaileysFiles, getCommitSha, resolveRef, PROTO_PATH, INDEX_PATH, DTS_PATH } from '../baileys.js';
import { parseWaVersion, protoStats } from '../proto.js';
import { c, fmtBytes, sha256 } from '../output.js';

export async function run({ args, flags }) {
  const ref = args[0] ?? 'latest';
  if (!args[0]) {
    console.log(c.yellow('No ref given — defaulting to "latest". (Use "master" for the freshest proto.)'));
  }

  const resolved = await resolveRef(ref);
  const wantStatic = flags.all || flags.static;
  const wantDts = flags.all || flags.dts;

  const { files } = await fetchBaileysFiles(resolved);
  const proto = files.get(PROTO_PATH);
  if (!proto) throw new Error(`No ${PROTO_PATH} in ref ${ref}`);

  let sha = null;
  if (resolved.kind === 'git') {
    try { sha = await getCommitSha(resolved.ref); } catch { /* optional */ }
  }

  const label = resolved.kind === 'npm' ? resolved.version : resolved.ref;
  const outDir = flags.out ?? flags.o ?? 'protos';
  const dir = join(outDir, label);
  mkdirSync(dir, { recursive: true });

  const written = {};
  const writeFile = (name, buf) => {
    writeFileSync(join(dir, name), buf);
    written[name] = { bytes: buf.length, sha256: sha256(buf) };
  };

  writeFile('WAProto.proto', proto);
  if (wantStatic) {
    const f = files.get(INDEX_PATH);
    if (!f) throw new Error(`No ${INDEX_PATH} in ref ${ref} (try a newer ref or drop --static)`);
    writeFile('index.js', f);
  }
  if (wantDts) {
    const f = files.get(DTS_PATH);
    if (!f) throw new Error(`No ${DTS_PATH} in ref ${ref} (try a newer ref or drop --dts)`);
    writeFile('index.d.ts', f);
  }

  const protoText = proto.toString('utf8');
  const meta = {
    tool: 'proto-fetcher (newest-whatsapp-proto)',
    fetchedAt: new Date().toISOString(),
    source: resolved.kind === 'npm' ? 'npm:@whiskeysockets/baileys' : 'github:WhiskeySockets/Baileys',
    input: ref,
    ref: resolved.kind === 'npm' ? resolved.version : resolved.ref,
    isBranch: resolved.isBranch ?? false,
    commit: sha,
    waVersion: parseWaVersion(protoText),
    stats: protoStats(protoText),
    files: written,
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  if (flags.json) {
    console.log(JSON.stringify({ outDir: dir, ...meta }, null, 2));
    return;
  }

  console.log('');
  console.log(`${c.green('✔')} saved to ${c.bold(dir)}`);
  for (const [name, info] of Object.entries(written)) {
    console.log(`  ${c.cyan(name.padEnd(14))} ${fmtBytes(info.bytes)}  ${c.dim(info.sha256.slice(0, 16) + '…')}`);
  }
  console.log(`  ${c.dim('meta.json'.padEnd(14))} source=${meta.source} ref=${meta.ref}${sha ? ` sha=${sha.slice(0, 7)}` : ''}`);
  console.log(`  ${c.dim('wa version'.padEnd(14))} ${meta.waVersion ?? 'unknown'}`);
}
