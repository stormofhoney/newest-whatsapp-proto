// proto-fetcher info — which WhatsApp version + proto stats does a ref contain?

import { fetchBaileysFiles, getCommitSha, resolveRef, PROTO_PATH } from '../baileys.js';
import { parseWaVersion, protoStats } from '../proto.js';
import { c, fmtBytes, kv, sha256 } from '../output.js';

export async function run({ args, flags }) {
  const ref = args[0] ?? 'latest';
  const resolved = await resolveRef(ref);

  let sha = null;
  if (resolved.kind === 'git') {
    try { sha = await getCommitSha(resolved.ref); } catch { /* optional */ }
  }

  const { files } = await fetchBaileysFiles(resolved);
  const proto = files.get(PROTO_PATH);
  if (!proto) {
    throw new Error(`No ${PROTO_PATH} found in ref ${ref} — is this really a Baileys tree?`);
  }
  const protoText = proto.toString('utf8');
  const waVersion = parseWaVersion(protoText);
  const stats = protoStats(protoText);

  if (flags.json) {
    console.log(JSON.stringify({
      input: ref,
      source: resolved.kind,
      ...(resolved.kind === 'npm' ? { npmVersion: resolved.version } : { gitRef: resolved.ref, commit: sha }),
      waVersion,
      proto: { bytes: stats.bytes, lines: stats.lines, messages: stats.messages, enums: stats.enums, sha256: sha256(proto) },
      fetchedAt: new Date().toISOString(),
    }, null, 2));
    return;
  }

  console.log(c.bold('Baileys proto info'));
  kv(2, 'input ref', ref);
  kv(2, 'source', resolved.kind === 'npm'
    ? `npm (${resolved.version})`
    : `git (${resolved.ref}${resolved.isBranch ? ' — branch' : ''})`);
  if (sha) kv(2, 'commit', sha.slice(0, 12));
  kv(2, 'wa version', waVersion ?? c.yellow('unknown (no header comment)'));
  kv(2, 'proto', `${PROTO_PATH} · ${fmtBytes(stats.bytes)} · ${stats.lines} lines`);
  kv(2, 'definitions', `${stats.messages} messages · ${stats.enums} enums${stats.services ? ` · ${stats.services} services` : ''}`);
  kv(2, 'sha256', `${sha256(proto).slice(0, 32)}…`);
  kv(2, 'fetched', new Date().toISOString());
}
