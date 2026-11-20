// Tiny argv parser — zero dependencies, testable without side effects.

const FLAGS_BOOL = new Set([
  'json', 'static', 'dts', 'all', 'rebuild', 'no-backup', 'dry-run',
  'help', 'h', 'version', 'no-color', 'quiet', 'q', 'verbose',
]);
const FLAGS_VALUE = new Set(['o', 'out', 'source', 'n', 'limit']);

export function parseArgv(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      let name = a.slice(2);
      let val;
      const eq = name.indexOf('=');
      if (eq !== -1) {
        val = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      const key = camel(name);
      if (FLAGS_VALUE.has(key) || (!FLAGS_BOOL.has(key) && eq !== -1)) {
        out.flags[key] = val ?? argv[++i];
      } else {
        out.flags[key] = true;
      }
    } else if (a.startsWith('-') && a.length > 1) {
      const key = camel(a.slice(1));
      if (FLAGS_VALUE.has(key)) {
        out.flags[key] = argv[++i];
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function camel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
