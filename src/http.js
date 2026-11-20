// Minimal HTTP layer on top of global fetch (Node >= 18). Zero deps.
//
// TLS note: some networks (corporate proxies, sandboxes) terminate TLS with a
// custom CA that Node's bundled Mozilla store doesn't know. When fetch fails
// certificate verification, we transparently retry over node:https using the
// OS CA bundle (still verified). Only if no OS bundle exists we fall back to
// skipping verification — with a loud warning.

import { existsSync, readFileSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';

const UA = 'newest-whatsapp-proto/1.0 (proto-fetcher; +https://github.com/stormofhoney/newest-whatsapp-proto)';

export class HttpError extends Error {
  constructor(status, message, url, hint) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.hint = hint;
    this.exitCode = 2;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const OS_CA_BUNDLES = [
  '/etc/ssl/certs/ca-certificates.crt', // Debian/Ubuntu/Alpine
  '/etc/pki/tls/certs/ca-bundle.crt',   // RHEL/Fedora
  '/etc/ssl/ca-bundle.pem',             // SUSE
  '/etc/ssl/cert.pem',                  // macOS / generic
  '/usr/local/etc/openssl/cert.pem',    // macOS (homebrew openssl)
  '/usr/local/share/certs/ca-root-nss.crt', // FreeBSD
];

function osCaBundle() {
  for (const p of OS_CA_BUNDLES) {
    try {
      if (existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return null;
}

function isTlsError(err) {
  const code = err?.cause?.code ?? err?.code;
  return (code && TLS_ERROR_CODES.has(code)) || String(err?.message ?? '').includes('certificate');
}

/** node:https fallback with manual redirect following (fetch is unavailable in broken-TLS setups). */
function legacyGet(url, { accept, timeout = 120000, ca, insecure = false } = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? httpsGet : httpGet;
    const req = mod(url, {
      headers: { 'user-agent': UA, ...(accept ? { accept } : {}) },
      ...(url.startsWith('https:') ? { ca: ca ?? undefined, rejectUnauthorized: !insecure } : {}),
      timeout,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        if (redirectsLeft <= 0) return reject(new HttpError(res.statusCode, `Too many redirects for ${url}`, url));
        return resolve(legacyGet(next, { accept, timeout, ca, insecure }, redirectsLeft - 1));
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(body);
        reject(new HttpError(res.statusCode, `HTTP ${res.statusCode} for ${url}`, url));
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout after ${timeout}ms: ${url}`)));
    req.on('error', (err) => reject(new HttpError(0, err.message, url)));
    req.end();
  });
}

let warnedInsecure = false;

async function getBody(url, opts) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, ...(opts.accept ? { accept: opts.accept } : {}) },
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeout ?? 120000),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    try { await res.arrayBuffer(); } catch { /* drain */ }
    if (res.status === 404) throw new HttpError(404, `Not found (404): ${url}`, url);
    if (res.status === 403 && url.includes('api.github.com')) {
      throw new HttpError(403, 'GitHub API rate limit reached (403).', url,
        'The GitHub API allows ~60 unauthenticated requests/hour. Try again later.');
    }
    if (res.status !== 429 && res.status < 500) {
      throw new HttpError(res.status, `HTTP ${res.status} ${res.statusText} for ${url}`, url);
    }
    throw new HttpError(res.status, `HTTP ${res.status} for ${url}`, url);
  } catch (err) {
    // TLS interception workaround (does not swallow HttpError from above —
    // those are re-thrown by the caller below)
    if (!(err instanceof HttpError) && isTlsError(err)) {
      const bundle = osCaBundle();
      if (bundle) {
        try {
          return await legacyGet(url, { ...opts, ca: readFileSync(bundle) });
        } catch (caErr) {
          // a real HTTP answer over the verified channel is definitive —
          // only fall through to insecure when the channel itself failed
          if (caErr instanceof HttpError && caErr.status >= 400) throw caErr;
        }
      }
      if (!warnedInsecure) {
        warnedInsecure = true;
        console.error('warning: TLS certificate verification failed (MITM proxy?); retrying without verification');
      }
      return await legacyGet(url, { ...opts, insecure: true });
    }
    throw err;
  }
}

/**
 * GET a URL and return the body as a Buffer.
 * Retries transient failures (network errors, 429, 5xx). Throws HttpError on 4xx.
 */
export async function fetchBuffer(url, { accept, timeout = 120000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1200 * attempt);
    try {
      return await getBody(url, { accept, timeout });
    } catch (err) {
      if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
      lastErr = err;
    }
  }
  throw lastErr ?? new HttpError(0, `Request failed: ${url}`, url);
}

export async function fetchJson(url, opts) {
  const buf = await fetchBuffer(url, opts);
  return JSON.parse(buf.toString('utf8'));
}

/** Like fetchJson but returns null on 404 (used for existence checks). */
export async function tryJson(url, opts) {
  try {
    return await fetchJson(url, opts);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}
