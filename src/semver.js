// Semver-ish helpers for Baileys tag names ("v7.0.0-rc14", "v7.0.0-rc.9", "6.7.24", …)

/** Parse a tag into comparable parts, or null if it doesn't look like a version. */
export function tagKey(t) {
  const m = /v?(\d+)\.(\d+)\.(\d+)(?:-rc\.?(\d+))?/i.exec(t);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : null];
}

/** Newest-first comparator (releases before prereleases, rc14 > rc13 > rc9). */
export function compareTags(a, b) {
  const ka = tagKey(a);
  const kb = tagKey(b);
  if (!ka && !kb) return 0;
  if (!ka) return 1;
  if (!kb) return -1;
  for (let i = 0; i < 3; i++) {
    if (ka[i] !== kb[i]) return kb[i] - ka[i];
  }
  const ra = ka[3];
  const rb = kb[3];
  if (ra === null && rb === null) return 0;
  if (ra === null) return -1; // release > prerelease
  if (rb === null) return 1;
  return rb - ra;
}
