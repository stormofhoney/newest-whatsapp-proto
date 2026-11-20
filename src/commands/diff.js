// proto-fetcher diff — what changed in the proto between two refs?

import { fetchBaileysFiles, resolveRef, PROTO_PATH } from '../baileys.js';
import { diffProtos } from '../proto.js';
import { c } from '../output.js';

export async function run({ args, flags }) {
  const refA = args[0];
  const refB = args[1] ?? 'master';
  if (!refA) {
    console.error('usage: proto-fetcher diff <refA> [refB=master]');
    process.exit(1);
  }

  const [resA, resB] = await Promise.all([resolveRef(refA), resolveRef(refB)]);
  const [{ files: fa }, { files: fb }] = await Promise.all([
    fetchBaileysFiles(resA),
    fetchBaileysFiles(resB),
  ]);
  const pa = fa.get(PROTO_PATH);
  const pb = fb.get(PROTO_PATH);
  if (!pa || !pb) throw new Error(`Missing ${PROTO_PATH} in one of the refs`);

  const d = diffProtos(pa.toString('utf8'), pb.toString('utf8'));

  if (flags.json) {
    console.log(JSON.stringify({ a: refA, b: refB, ...d }, null, 2));
    return;
  }

  const label = (r) => (r.kind === 'npm' ? r.version : r.ref);
  console.log(c.bold(`proto diff: ${label(resA)} → ${label(resB)}`));
  console.log(`  ${c.dim('wa version')} ${d.a.waVersion ?? '?'} ${c.dim('→')} ${d.b.waVersion ?? '?'}`);
  console.log(`  ${c.dim('size')}      ${d.a.stats.lines} lines ${c.dim('→')} ${d.b.stats.lines} lines (${d.b.stats.lines - d.a.stats.lines >= 0 ? '+' : ''}${d.b.stats.lines - d.a.stats.lines})`);
  console.log(`  ${c.dim('defs')}      ${d.a.stats.messages} messages/${d.a.stats.enums} enums ${c.dim('→')} ${d.b.stats.messages} messages/${d.b.stats.enums} enums`);
  console.log('');

  const list = (items, colorFn, sign) => {
    if (items.length === 0) return console.log(c.dim(`  ${sign} none`));
    for (const it of items) console.log(`  ${colorFn(sign)} ${c.bold(it.name)} ${c.dim(`(${it.kind})`)}`);
  };

  console.log(c.bold(`added (${d.added.length})`));
  list(d.added, c.green, '+');
  console.log('');
  console.log(c.bold(`removed (${d.removed.length})`));
  list(d.removed, c.red, '-');
  console.log('');
  console.log(c.bold(`changed (${d.changed.length})`));
  list(d.changed, c.yellow, '~');
}
