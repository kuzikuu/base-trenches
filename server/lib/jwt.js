// JWT helpers for Farcaster Quick Auth (RS256) and Privy access tokens (ES256).
// Works in Cloudflare Workers and Node (crypto.subtle). JWKS fetch is injectable for tests.

export const FARCASTER_QUICK_AUTH_ISSUER = 'https://auth.farcaster.xyz';
export const QUICK_AUTH_AUDIENCES = ['base-trenches.pages.dev', 'kuzikuu.github.io'];
export const PRIVY_ISSUER = 'privy.io';

export function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

export function b64urlEncode(bytes) {
  const bin = String.fromCharCode(...(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToJson(str) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(str)));
}

export function parseJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: b64urlToJson(parts[0]),
      payload: b64urlToJson(parts[1]),
      headerB64: parts[0],
      payloadB64: parts[1],
      signatureB64: parts[2],
      signingInput: `${parts[0]}.${parts[1]}`
    };
  } catch {
    return null;
  }
}

function nowSec(now) {
  return (now != null ? now : Date.now()) / 1000;
}

export function checkRegisteredClaims(payload, { iss, aud, now } = {}) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'no_payload' };
  const t = nowSec(now);
  if (!payload.exp || payload.exp < t) return { ok: false, reason: 'expired' };
  if (payload.nbf && payload.nbf > t + 60) return { ok: false, reason: 'nbf' };
  if (iss != null && payload.iss !== iss) return { ok: false, reason: 'iss' };
  if (aud != null) {
    const allowed = Array.isArray(aud) ? aud : [aud];
    const got = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!got.some(a => allowed.includes(a))) return { ok: false, reason: 'aud' };
  }
  return { ok: true };
}

export function privyJwksUrl(appId) {
  return `https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}/jwks.json`;
}

export function farcasterJwksUrl() {
  return `${FARCASTER_QUICK_AUTH_ISSUER}/.well-known/jwks.json`;
}

function findJwk(jwks, kid) {
  const keys = (jwks && jwks.keys) || [];
  if (kid) return keys.find(k => k.kid === kid) || null;
  return keys[0] || null;
}

async function importRsaVerifyKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

async function importEcVerifyKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: jwk.crv || 'P-256', x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
}

/**
 * Verify an ES256 JWT against a JWKS (Privy access tokens).
 * getJwks() must return { keys: [...] }. Inject a local JWKS in tests.
 */
export async function verifyEs256Jwt(token, { getJwks, iss, aud, now } = {}) {
  const parsed = parseJwt(token);
  if (!parsed) return null;
  if (parsed.header.alg !== 'ES256') return null;
  const claims = checkRegisteredClaims(parsed.payload, { iss, aud, now });
  if (!claims.ok) return null;
  if (typeof getJwks !== 'function') return null;
  const jwks = await getJwks();
  const jwk = findJwk(jwks, parsed.header.kid);
  if (!jwk || (jwk.kty && jwk.kty !== 'EC')) return null;
  try {
    const key = await importEcVerifyKey(jwk);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      b64urlToBytes(parsed.signatureB64),
      new TextEncoder().encode(parsed.signingInput)
    );
    return valid ? parsed.payload : null;
  } catch {
    return null;
  }
}

/**
 * Verify an RS256 JWT against a JWKS (Farcaster Quick Auth).
 */
export async function verifyRs256Jwt(token, { getJwks, iss, aud, now } = {}) {
  const parsed = parseJwt(token);
  if (!parsed) return null;
  if (parsed.header.alg !== 'RS256') return null;
  const claims = checkRegisteredClaims(parsed.payload, { iss, aud, now });
  if (!claims.ok) return null;
  if (typeof getJwks !== 'function') return null;
  const jwks = await getJwks();
  const jwk = findJwk(jwks, parsed.header.kid);
  if (!jwk) return null;
  try {
    const key = await importRsaVerifyKey(jwk);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parsed.signatureB64),
      new TextEncoder().encode(parsed.signingInput)
    );
    return valid ? parsed.payload : null;
  } catch {
    return null;
  }
}

const jwksMemo = new Map();

export async function fetchJwks(url, { fetchFn = fetch, ttlMs = 3600_000, cache = jwksMemo } = {}) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.jwks;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error('JWKS fetch failed: ' + res.status);
  const jwks = await res.json();
  cache.set(url, { jwks, at: Date.now() });
  return jwks;
}

export function clearJwksCache() {
  jwksMemo.clear();
}

/**
 * Privy access token: ES256, iss 'privy.io', aud = app id, sub = Privy DID.
 * getJwks is optional; default fetches https://auth.privy.io/api/v1/apps/<appId>/jwks.json
 */
export async function verifyPrivyToken(token, appId, opts = {}) {
  if (!token || !appId) return null;
  const getJwks = opts.getJwks || (() => fetchJwks(privyJwksUrl(appId), opts));
  const payload = await verifyEs256Jwt(token, {
    getJwks,
    iss: PRIVY_ISSUER,
    aud: appId,
    now: opts.now
  });
  if (!payload) return null;
  const did = typeof payload.sub === 'string' ? payload.sub : '';
  if (!did.startsWith('did:privy:')) return null;
  return { did, payload };
}

export async function verifyFarcasterToken(token, opts = {}) {
  if (!token) return null;
  const getJwks = opts.getJwks || (() => fetchJwks(farcasterJwksUrl(), opts));
  const payload = await verifyRs256Jwt(token, {
    getJwks,
    iss: FARCASTER_QUICK_AUTH_ISSUER,
    aud: opts.audiences || QUICK_AUTH_AUDIENCES,
    now: opts.now
  });
  if (!payload) return null;
  const fid = Number(payload.sub);
  return Number.isSafeInteger(fid) && fid > 0 ? fid : null;
}

/** Sign an ES256 JWT with a CryptoKey (tests). */
export async function signEs256Jwt(payload, privateKey, { kid, header } = {}) {
  const h = { alg: 'ES256', typ: 'JWT', ...(kid ? { kid } : {}), ...header };
  const enc = (obj) => b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
  const input = `${enc(h)}.${enc(payload)}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(input)
  );
  return `${input}.${b64urlEncode(sig)}`;
}

export async function generateEs256TestKey(kid = 'test-privy') {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    jwk: { ...jwk, kid, use: 'sig', alg: 'ES256' },
    jwks: { keys: [{ ...jwk, kid, use: 'sig', alg: 'ES256' }] },
    kid
  };
}
