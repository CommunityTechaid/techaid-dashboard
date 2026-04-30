#!/usr/bin/env node
/**
 * Saves a bearer token into the Playwright storageState format so e2e tests
 * can run without going through the Auth0 login flow.
 *
 * auth0-spa-js v2 (used by @auth0/auth0-angular v2) cache structure (derived from
 * reading the SDK source at dist/auth0-spa-js.development.js):
 *
 *  Access-token entry  key: @@auth0spajs@@::<clientId>::<audience>::<scope>
 *                     value: { body: CacheEntry, expiresAt: <seconds> }
 *
 *  Id-token entry      key: @@auth0spajs@@::<clientId>::@@user@@
 *                     value: { id_token: <jwt>, decodedToken: {...} }
 *                     (NOT wrapped — stored by CacheManager.setIdToken() directly)
 *
 *  Auth cookie    name: auth0.<clientId>.is.authenticated  (new format v2)
 *                       auth0.is.authenticated             (old format, also accepted)
 *               checkSession() returns early without reading localStorage if BOTH are absent.
 *
 * Usage (PowerShell):
 *   $env:E2E_BEARER_TOKEN="eyJ..."
 *   node e2e/save-token.mjs
 *
 * Usage (cmd):
 *   set E2E_BEARER_TOKEN=eyJ...
 *   node e2e/save-token.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const token = process.env.E2E_BEARER_TOKEN;
if (!token) {
  console.error('Error: E2E_BEARER_TOKEN environment variable is not set.');
  process.exit(1);
}

// Decode JWT payload (no signature verification — we trust our own token)
const parts = token.split('.');
if (parts.length !== 3) {
  console.error('Error: E2E_BEARER_TOKEN does not look like a JWT (expected 3 dot-separated parts).');
  process.exit(1);
}

let claims;
try {
  claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
} catch {
  console.error('Error: Could not decode JWT payload.');
  process.exit(1);
}

const expiresAt = claims.exp;
if (!expiresAt) {
  console.error('Error: JWT has no `exp` claim.');
  process.exit(1);
}

const nowSeconds = Math.floor(Date.now() / 1000);
const expiresIn = expiresAt - nowSeconds;

if (expiresIn <= 0) {
  console.error(`Error: Token expired at ${new Date(expiresAt * 1000).toISOString()} — get a fresh token.`);
  process.exit(1);
}

console.log(`Token expires at: ${new Date(expiresAt * 1000).toISOString()} (${Math.round(expiresIn / 3600 * 10) / 10}h from now)`);

// Auth0 SPA JS v2 cache key: @@auth0spajs@@::<clientId>::<audience>::<scope>
const clientId  = 'puJcT35DydtxJUsOfjNFVg7MBf19UDzX';
const audience  = 'https://api.communitytechaid.org.uk';
const scope     = 'openid profile email';
const cacheKey  = `@@auth0spajs@@::${clientId}::${audience}::${scope}`;

// Synthesize a minimal id_token JWT from access-token claims.
// The SDK does NOT re-verify the signature of cached tokens — a placeholder sig is fine.
const email = claims.email
  ?? claims['https://communitytechaid.org.uk/email']
  ?? 'user@example.com';
const name  = claims.name ?? claims.sub;

const idTokenPayload = {
  sub:   claims.sub,
  aud:   clientId,
  iss:   'https://techaid-auth.eu.auth0.com/',
  iat:   claims.iat ?? nowSeconds,
  exp:   expiresAt,
  email,
  name,
};

const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const idTokenHeader  = b64url({ alg: 'RS256', typ: 'JWT', kid: 'e2e-synthetic' });
const idTokenPayloadB64 = b64url(idTokenPayload);
const idToken = `${idTokenHeader}.${idTokenPayloadB64}.e2e_placeholder_sig`;

const decodedToken = {
  claims:  idTokenPayload,
  user:    { sub: claims.sub, email, name },
  encoded: {
    header:    idTokenHeader,
    payload:   idTokenPayloadB64,
    signature: 'e2e_placeholder_sig',
  },
};

// Access-token entry: wrapped in { body, expiresAt }
const cacheBody = {
  access_token: token,
  id_token:     idToken,
  scope,
  expires_in:   expiresIn,
  token_type:   'Bearer',
  audience,
  client_id:    clientId,
  decodedToken,
};
const cacheValue = JSON.stringify({ body: cacheBody, expiresAt });

// Id-token entry: stored DIRECTLY (not wrapped) at @@auth0spajs@@::<clientId>::@@user@@
// CacheManager.setIdToken() calls cache.set(cacheKey, { id_token, decodedToken }) without wrapping.
const idTokenCacheKey   = `@@auth0spajs@@::${clientId}::@@user@@`;
const idTokenCacheValue = JSON.stringify({ id_token: idToken, decodedToken });

// auth0-spa-js v2 checkSession() checks for "auth0.<clientId>.is.authenticated" cookie first,
// then falls back to the old "auth0.is.authenticated" cookie.  Without either, it returns
// early without touching localStorage.  We write the new-format cookie.
const authCookie = {
  name:     `auth0.${clientId}.is.authenticated`,
  value:    'true',
  domain:   'localhost',
  path:     '/',
  expires:  expiresAt,   // seconds since epoch — Playwright accepts this format
  httpOnly: false,
  secure:   false,
  sameSite: 'Lax',
};

const storageState = {
  cookies: [authCookie],
  origins: [
    {
      origin: 'http://localhost:4200',
      localStorage: [
        { name: cacheKey,        value: cacheValue        },
        { name: idTokenCacheKey, value: idTokenCacheValue },
      ],
    },
  ],
};

// Deployed UAT front-end storageState (used by playwright.config.uat.ts)
const deployedAuthCookie = {
  name:     `auth0.${clientId}.is.authenticated`,
  value:    'true',
  domain:   'app-testing.communitytechaid.org.uk',
  path:     '/',
  expires:  expiresAt,
  httpOnly: false,
  secure:   true,
  sameSite: 'Lax',
};

const storageStateDeployed = {
  cookies: [deployedAuthCookie],
  origins: [
    {
      origin: 'https://app-testing.communitytechaid.org.uk',
      localStorage: [
        { name: cacheKey,        value: cacheValue        },
        { name: idTokenCacheKey, value: idTokenCacheValue },
      ],
    },
  ],
};

const outDir           = join(__dirname, '.auth');
const outPath          = join(outDir, 'user.json');
const outPathDeployed  = join(outDir, 'uat-deployed.json');
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath,         JSON.stringify(storageState,         null, 2));
writeFileSync(outPathDeployed, JSON.stringify(storageStateDeployed, null, 2));

console.log(`Saved storageState → ${outPath}`);
console.log(`Saved storageState → ${outPathDeployed}`);
console.log('You can now run:');
console.log('  npx playwright test                                        (local ng serve + UAT API)');
console.log('  npx playwright test --config playwright.config.uat.ts     (deployed UAT front-end)');
