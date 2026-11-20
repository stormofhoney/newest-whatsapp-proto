#!/usr/bin/env node
// CLI entry — parses argv, dispatches to commands in src/commands/.

import { parseArgv } from './args.js';

const { _, flags } = parseArgv(process.argv.slice(2));

if (flags.version) {
  console.log('proto-fetcher 1.0.0');
  process.exit(0);
}

const HELP = `
proto-fetcher — fetch the newest WhatsApp proto shipped with Baileys

USAGE
  proto-fetcher <command> [args] [flags]

COMMANDS
  list [-n <count>]              List recent Baileys tags + npm dist-tags
  info <ref>                     Show which WhatsApp version + proto stats a ref contains
  get <ref> [-o dir]             Download WAProto.proto (+ artifacts) into ./protos/<ref>/
  diff <refA> [refB=master]      Diff the proto of two versions (what changed)
  update <target>                Patch a Baileys checkout / node_modules install
                                 with the newest proto artifacts
  help                           Show this help

REFS
  <semver>                       e.g. 7.0.0-rc14, v7.0.0-rc.9, 6.7.24  (npm package)
  latest                         newest npm release (dist-tag "latest")
  legacy                         last 6.x release (dist-tag "legacy")
  master | newest                current Baileys master branch — the freshest proto,
                                 updated daily by Baileys' own proto-extract bot
  <git-sha>                      any commit sha (7-40 hex chars)

GET FLAGS
  --static                       also extract WAProto/index.js (built static module)
  --dts                          also extract WAProto/index.d.ts (TS types)
  --all                          extract proto + index.js + index.d.ts
  -o, --out <dir>                output dir (default: ./protos)

UPDATE FLAGS
  --source <ref>                 which ref to take the proto from (default: master)
  --rebuild                      regenerate index.js/index.d.ts from the fetched .proto
                                 via pbjs/pbts (needs npx / protobufjs-cli) instead of
                                 taking the prebuilt artifacts
  --dry-run                      only show what would change
  --no-backup                    do not back up the existing WAProto files

GLOBAL FLAGS
  --json                         machine-readable JSON output
  --no-color                     disable colors
`;

if (flags.help || _.length === 0 || _[0] === 'help') {
  if (_.length === 0 && !flags.help) console.log('No command given.\n');
  console.log(HELP.trimStart());
  process.exit(_.length === 0 ? 1 : 0);
}

const cmd = _[0];
const commands = {
  list: () => import('./commands/list.js'),
  info: () => import('./commands/info.js'),
  get: () => import('./commands/get.js'),
  diff: () => import('./commands/diff.js'),
  update: () => import('./commands/update.js'),
};

if (!commands[cmd]) {
  console.error(`Unknown command: ${cmd}\n`);
  console.error(HELP.trimStart());
  process.exit(1);
}

try {
  const mod = await commands[cmd]();
  await mod.run({ args: _.slice(1), flags });
} catch (err) {
  if (flags.json) {
    console.error(JSON.stringify({ error: String(err?.message ?? err) }, null, 2));
  } else {
    console.error(`\x1b[31merror:\x1b[39m ${err?.message ?? err}`);
    if (err?.hint) console.error(`\x1b[2m${err.hint}\x1b[39m`);
    if (process.env.DEBUG) console.error(err);
  }
  process.exit(err?.exitCode ?? 1);
}
