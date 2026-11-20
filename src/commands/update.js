// proto-fetcher update — give an existing Baileys checkout/install the newest proto.
//
// Default source is the Baileys master branch, which carries the freshest
// WhatsApp proto (their daily proto-extract bot). The prebuilt index.js /
// index.d.ts from that same ref are copied along, so no protobuf toolchain
// is required. With --rebuild the artifacts are regenerated from the .proto
// via pbjs/pbts (protobufjs-cli) instead, replicating Baileys' own
// GenerateStatics.sh + fix-imports.js pipeline.

import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  fetchBaileysFiles, resolveRef,
  PROTO_PATH, INDEX_PATH, DTS_PATH, FIX_IMPORTS_PATH,
} from '../baileys.js';
import { parseWaVersion, protoStats } from '../proto.js';
import { c, fmtBytes, sha256 } from '../output.js';

const TARGET_FILES = [PROTO_PATH, INDEX_PATH, DTS_PATH];

export async function run({ args, flags }) {
  const target = args[0];
  if (!target) {
    console.error('usage: proto-fetcher update <path-to-baileys-checkout-or-install> [--source <ref>] [--rebuild] [--dry-run] [--no-backup]');
    process.exit(1);
  }
  const targetDir = resolve(target);
  if (!existsSync(targetDir)) {
    throw new Error(`Target directory does not exist: ${targetDir}`);
  }

  // --- validate that this is a Baileys tree --------------------------------
  const pkgJsonPath = join(targetDir, 'package.json');
  let looksLikeBaileys = false;
  if (existsSync(pkgJsonPath)) {
    try {
      looksLikeBaileys = String(JSON.parse(readFileSync(pkgJsonPath, 'utf8'))?.name ?? '').includes('baileys');
    } catch { /* ignore */ }
  }
  const waDir = join(targetDir, 'WAProto');
  if (!looksLikeBaileys && !existsSync(waDir)) {
    throw new Error(`"${targetDir}" does not look like a Baileys checkout/install (no baileys package.json, no WAProto/).`);
  }

  // --- fetch newest artifacts ----------------------------------------------
  const ref = flags.source ?? 'master';
  console.log(c.dim(`resolving source ref "${ref}" …`));
  const resolved = await resolveRef(ref);
  console.log(c.dim(`downloading ${resolved.kind === 'npm' ? `npm ${resolved.version}` : `git ${resolved.ref}`} …`));
  const { files } = await fetchBaileysFiles(resolved);

  const proto = files.get(PROTO_PATH);
  if (!proto) throw new Error(`No ${PROTO_PATH} in ${ref}`);

  let artifacts = new Map([[PROTO_PATH, proto]]);
  if (flags.rebuild) {
    console.log(c.dim('rebuilding index.js/index.d.ts from the fetched .proto (pbjs/pbts) …'));
    const built = rebuildArtifacts(proto, files.get(FIX_IMPORTS_PATH));
    artifacts.set(INDEX_PATH, built.indexJs);
    artifacts.set(DTS_PATH, built.indexDts);
  } else {
    for (const p of [INDEX_PATH, DTS_PATH]) {
      const f = files.get(p);
      if (!f) {
        throw new Error(`Prebuilt ${p} is missing in ref ${ref} — use --rebuild to generate it from the .proto.`);
      }
      artifacts.set(p, f);
    }
  }

  // --- diff against what's there -------------------------------------------
  const current = new Map(
    TARGET_FILES.map((p) => [p, existsSync(join(waDir, basename(p))) ? readFileSync(join(waDir, basename(p))) : null]),
  );
  const oldWa = current.get(PROTO_PATH) ? parseWaVersion(current.get(PROTO_PATH).toString('utf8')) : null;
  const newWa = parseWaVersion(proto.toString('utf8'));
  const srcLabel = resolved.kind === 'npm' ? `npm@${resolved.version}` : `git@${resolved.ref}`;
  const dirty = [...artifacts.entries()].filter(([p, buf]) => {
    const cur = current.get(p);
    return !cur || cur.equals(buf) === false;
  });

  console.log('');
  console.log(c.bold(`update plan (${srcLabel} → ${targetDir})`));
  console.log(`  ${c.dim('wa version')}  ${oldWa ?? '(none)'} ${c.dim('→')} ${newWa ?? '(unknown)'}`);
  for (const [p, buf] of artifacts.entries()) {
    const cur = current.get(p);
    const status = !cur ? c.green('new')
      : cur.equals(buf) ? c.dim('unchanged')
        : c.yellow(`changed ${fmtBytes(cur.length)} → ${fmtBytes(buf.length)}`);
    console.log(`  ${c.dim(basename(p).padEnd(14))} ${status}`);
  }

  if (flags.dryRun) {
    console.log('');
    console.log(c.dim('dry-run — nothing written. Drop --dry-run to apply.'));
    return;
  }
  if (dirty.length === 0 && oldWa === newWa) {
    console.log('');
    console.log(`${c.green('✔')} already up to date (${srcLabel}). Nothing to do.`);
    return;
  }

  // --- backup ---------------------------------------------------------------
  if (!flags.noBackup) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bakDir = join(targetDir, `.proto-fetcher-backup-${stamp}`);
    mkdirSync(join(bakDir, 'WAProto'), { recursive: true });
    let backedUp = 0;
    for (const [p, cur] of current.entries()) {
      if (cur) {
        writeFileSync(join(bakDir, 'WAProto', basename(p)), cur);
        backedUp++;
      }
    }
    console.log('');
    console.log(`${c.cyan('backup')}  ${backedUp} file(s) → ${bakDir}`);
  }

  // --- write -----------------------------------------------------------------
  mkdirSync(waDir, { recursive: true });
  for (const [p, buf] of artifacts.entries()) {
    writeFileSync(join(waDir, basename(p)), buf);
  }

  console.log('');
  console.log(`${c.green('✔')} updated ${artifacts.size} file(s) in ${c.bold(waDir)} (${srcLabel})`);
  for (const [p, buf] of artifacts.entries()) {
    console.log(`  ${c.cyan(basename(p).padEnd(14))} ${fmtBytes(buf.length)}  ${c.dim(sha256(buf).slice(0, 16) + '…')}`);
  }
  console.log('');
  console.log(c.dim('note: restart your Baileys process / rebuild your bundle so the new proto is picked up.'));
  console.log(c.dim('      if the newer proto renamed fields your code or Baileys uses, things can break — that\'s what the backup is for.'));
}

// ---------------------------------------------------------------------------
// pbjs/pbts rebuild — replicates WAProto/GenerateStatics.sh + fix-imports.js

function runTool(bin, args, { cwd, input } = {}) {
  const opts = { encoding: 'utf8', cwd, input, timeout: 600000, maxBuffer: 256 * 1024 * 1024 };
  let r = spawnSync(bin, args, opts);
  if (r.error && r.error.code === 'ENOENT') {
    // not on PATH — pull a Baileys-compatible version via npx.
    // (pinned: newer CLIs emit code for protobufjs 2.x runtime, which breaks
    // protobufjs ^7.x that Baileys links against)
    r = spawnSync('npx', ['--yes', '-p', 'protobufjs-cli@1.2.0', bin, ...args], {
      ...opts,
      shell: process.platform === 'win32',
    });
  }
  if (r.error && r.error.code === 'ENOENT') {
    throw new Error(`"${bin}" not found and npx is unavailable. Install protobufjs-cli first: npm i -g protobufjs-cli`);
  }
  if (r.status !== 0) {
    throw new Error(`${bin} exited with ${r.status}:\n${(r.stderr || r.stdout || '').trim().split('\n').slice(-8).join('\n')}`);
  }
  return r.stdout;
}

function rebuildArtifacts(protoBuf, fixImportsBuf) {
  const tmp = mkdtempSync(join(tmpdir(), 'proto-fetcher-'));
  try {
    writeFileSync(join(tmp, 'WAProto.proto'), protoBuf);
    if (fixImportsBuf) writeFileSync(join(tmp, 'fix-imports.js'), fixImportsBuf);

    runTool('pbjs', [
      '-t', 'static-module', '--no-beautify', '-w', 'es6', '--no-bundle',
      '--no-delimited', '--no-verify', '--no-comments',
      '-o', join(tmp, 'index.js'), 'WAProto.proto',
    ], { cwd: tmp });

    // d.ts: pbjs WITHOUT --no-comments piped into pbts (as GenerateStatics.sh does)
    const jsForDts = runTool('pbjs', [
      '-t', 'static-module', '--no-beautify', '-w', 'es6', '--no-bundle',
      '--no-delimited', '--no-verify', 'WAProto.proto',
    ], { cwd: tmp });
    runTool('pbts', ['--no-comments', '-o', join(tmp, 'index.d.ts'), '-'], { cwd: tmp, input: jsForDts });

    if (fixImportsBuf) {
      runTool('node', ['fix-imports.js'], { cwd: tmp });
    }

    return {
      indexJs: readFileSync(join(tmp, 'index.js')),
      indexDts: readFileSync(join(tmp, 'index.d.ts')),
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
