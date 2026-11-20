// Parsing helpers for the WhatsApp .proto definition.

export function parseWaVersion(protoText) {
  const m = /^\s*\/\/\/\s*WhatsApp Version:\s*([^\r\n]+)\s*$/m.exec(protoText);
  return m ? m[1].trim() : null;
}

/**
 * Extract top-level message/enum/service blocks.
 * Returns [{ kind, name, body }] where body is the full source block.
 */
export function topLevelBlocks(protoText) {
  const blocks = [];
  const lines = protoText.split('\n');
  let cur = null;
  let depth = 0;
  let buf = [];
  const braceDelta = (line) => {
    const code = line.replace(/\/\/.*$/, '');
    let d = 0;
    for (const ch of code) {
      if (ch === '{') d++;
      else if (ch === '}') d--;
    }
    return d;
  };
  for (const line of lines) {
    if (!cur) {
      const m = /^\s*(message|enum|service)\s+([A-Za-z_][\w.]*)\s*\{/.exec(line);
      if (!m) continue;
      cur = { kind: m[1], name: m[2] };
      buf = [line];
      depth = braceDelta(line);
      if (depth <= 0) {
        cur.body = buf.join('\n');
        blocks.push(cur);
        cur = null;
      }
    } else {
      buf.push(line);
      depth += braceDelta(line);
      if (depth <= 0) {
        cur.body = buf.join('\n');
        blocks.push(cur);
        cur = null;
      }
    }
  }
  return blocks;
}

export function protoStats(protoText) {
  const blocks = topLevelBlocks(protoText);
  const messages = blocks.filter((b) => b.kind === 'message').length;
  const enums = blocks.filter((b) => b.kind === 'enum').length;
  const services = blocks.filter((b) => b.kind === 'service').length;
  return {
    messages,
    enums,
    services,
    lines: protoText.split('\n').length,
    bytes: Buffer.byteLength(protoText, 'utf8'),
  };
}

function normBody(body) {
  return body.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

/**
 * Compare two proto sources.
 * Returns { a, b, added, removed, changed } with per-type details.
 */
export function diffProtos(aText, bText) {
  const aBlocks = topLevelBlocks(aText);
  const bBlocks = topLevelBlocks(bText);
  const aMap = new Map(aBlocks.map((b) => [`${b.kind}:${b.name}`, b]));
  const bMap = new Map(bBlocks.map((b) => [`${b.kind}:${b.name}`, b]));

  const added = bBlocks.filter((b) => !aMap.has(`${b.kind}:${b.name}`))
    .map((b) => ({ kind: b.kind, name: b.name }));
  const removed = aBlocks.filter((b) => !bMap.has(`${b.kind}:${b.name}`))
    .map((b) => ({ kind: b.kind, name: b.name }));
  const changed = aBlocks
    .filter((b) => {
      const other = bMap.get(`${b.kind}:${b.name}`);
      return other && normBody(other.body) !== normBody(b.body);
    })
    .map((b) => ({ kind: b.kind, name: b.name }));

  return {
    a: { waVersion: parseWaVersion(aText), stats: protoStats(aText) },
    b: { waVersion: parseWaVersion(bText), stats: protoStats(bText) },
    added,
    removed,
    changed,
  };
}
