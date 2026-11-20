// Baileys/WhatsApp constants, ref resolution and tarball fetching.

import { gunzipSync } from 'node:zlib';
import { fetchBuffer, fetchJson, tryJson } from './http.js';
import { parseTar } from './tar.js';

export const REPO = 'WhiskeySockets/Baileys';
export const PKG = '@whiskeysockets/baileys';

export const PROTO_PATH = 'WAProto/WAProto.proto';
export const INDEX_PATH = 'WAProto/index.js';
export const DTS_PATH = 'WAProto/index.d.ts';
export const FIX_IMPORTS_PATH = 'WAProto/fix-imports.js';
export const VERSION_JSON_PATH = 'src/Defaults/baileys-version.json';

/** npm package artifacts we know how to extract */
export const ARTIFACTS = [PROTO_PATH, INDEX_PATH, DTS_PATH, FIX_IMPORTS_PATH];

export class NotFoundError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'NotFoundError';
    this.hint = hint;
    this.exitCode = 3;
  }
}

const GIT_BRANCH_ALIASES = new Set(['master', 'main', 'head', 'newest']);

const npmVersionUrl = (v) => `https://registry.npmjs.org/${encodeURIComponent(PKG).replace('%40', '@')}/${v}`;
const NPM_DIST_TAGS_URL = `https://registry.npmjs.org/-/package/${encodeURIComponent(PKG).replace('%40', '@')}/dist-tags`;
const GIT_REF_URL = (kind, name) => `https://api.github.com/repos/${REPO}/git/ref/${kind}/${name}`;
const GIT_COMMIT_URL = (ref) => `https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(ref)}`;

export async function getDistTags() {
  return fetchJson(NPM_DIST_TAGS_URL);
}

export async function listGitTags(limit = 100) {
  const data = await fetchJson(`https://api.github.com/repos/${REPO}/tags?per_page=${limit}`);
  return data.map((t) => t.name);
}

export async function getCommitSha(ref) {
  const data = await fetchJson(GIT_COMMIT_URL(ref));
  return data.sha;
}

function variantList(v) {
  // Baileys tag naming is inconsistent: rc1..rc8 use "rc.N", newer ones "rcN"
  return [...new Set([v, v.replace(/-rc\.(\d+)$/, '-rc$1'), v.replace(/-rc(\d+)$/, '-rc.$1')])];
}

/**
 * Resolve a user-supplied ref to a concrete source.
 * Returns one of:
 *   { kind: 'npm',  version, tarballUrl }
 *   { kind: 'git',  ref, isBranch, tarballUrl }
 */
export async function resolveRef(input) {
  const raw = String(input).trim();
  const low = raw.toLowerCase();

  if (GIT_BRANCH_ALIASES.has(low)) {
    return { kind: 'git', ref: 'master', isBranch: true, tarballUrl: `https://codeload.github.com/${REPO}/tar.gz/refs/heads/master` };
  }

  // dist-tags (latest, legacy, next, …)
  if (low === 'latest' || low === 'legacy' || low === 'next' || low === 'beta') {
    const tags = await getDistTags();
    const v = tags[low];
    if (!v) throw new NotFoundError(`npm dist-tag "${raw}" does not exist for ${PKG}. Available: ${Object.keys(tags).join(', ')}`);
    return { kind: 'npm', version: v, tarballUrl: `https://registry.npmjs.org/${PKG}/-/${PKG.split('/')[1]}-${v}.tgz` };
  }

  // npm versions (with rc/rc. normalization)
  const v = raw.replace(/^v(?=\d)/i, '');
  for (const cand of variantList(v)) {
    const m = await tryJson(npmVersionUrl(cand));
    if (m?.dist?.tarball) {
      return { kind: 'npm', version: m.version, tarballUrl: m.dist.tarball };
    }
  }

  // git commit sha
  if (/^[0-9a-f]{7,40}$/i.test(raw) && /[0-9]/.test(raw) && /[a-f]/i.test(raw)) {
    return { kind: 'git', ref: raw.toLowerCase(), isBranch: false, tarballUrl: `https://codeload.github.com/${REPO}/tar.gz/${raw.toLowerCase()}` };
  }

  // git tags (try plain + v-prefixed + rc-normalized)
  for (const cand of [...new Set([raw, `v${v}`, ...variantList(v).map((x) => `v${x}`)])]) {
    const r = await tryJson(GIT_REF_URL('tags', cand));
    if (r) {
      return { kind: 'git', ref: cand, isBranch: false, tarballUrl: `https://codeload.github.com/${REPO}/tar.gz/refs/tags/${cand}` };
    }
  }

  // arbitrary git branch
  const branch = await tryJson(GIT_REF_URL('heads', raw));
  if (branch) {
    return { kind: 'git', ref: raw, isBranch: true, tarballUrl: `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${raw}` };
  }

  // give helpful suggestions
  let suggestions = [];
  try {
    const tags = await listGitTags(100);
    const base = v.split('.').slice(0, 2).join('.'); // e.g. "7.0" from "7.0.0-rc14"
    suggestions = tags.filter((t) => t.replace(/^v/, '').startsWith(base)).slice(0, 8);
    if (suggestions.length === 0) suggestions = tags.slice(0, 8);
  } catch { /* rate limited — skip suggestions */ }
  throw new NotFoundError(
    `Could not resolve ref "${raw}" — not an npm version/dist-tag, git tag, branch or sha of ${REPO}.`,
    suggestions.length ? `Did you mean: ${suggestions.join(', ')}?` : undefined,
  );
}

/** Download a resolved ref's tarball and return { files: Map<path, Buffer>, ... } */
export async function fetchBaileysFiles(resolved) {
  let buf = await fetchBuffer(resolved.tarballUrl, { timeout: 300000 });
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = gunzipSync(buf); // .tgz / tar.gz
  }
  const files = parseTar(buf);
  return { files, bytes: buf.length };
}

export function pickFiles(filesMap) {
  const out = {};
  for (const p of ARTIFACTS) {
    const f = filesMap.get(p);
    if (f) out[p] = f;
  }
  return out;
}
