#!/usr/bin/env node
/**
 * Saves a bearer token into the Playwright storageState format so e2e tests
 * can run without going through the Auth0 login flow.
 *
 * The Auth0 SPA JS v1 localStorage cache requires the full cache entry shape,
 * including a `decodedToken` with `claims` and `user`. We derive these from
 * the access token JWT payload (since we only have an access token, not an ID token,
 * we use its claims as a stand-in — enough for isAuthenticated() to return true).
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

// Auth0 SPA JS v1 cache key: @@auth0spajs@@::<clientId>::<audience>::<scope>
// The scope must match exactly what the SDK uses when calling getUser() with no options:
//   getUniqueScopes(this.defaultScope, this.scope) → 'openid profile email'
// (app does not set this.scope, so this.scope is undefined)
const clientId  = 'puJcT35DydtxJUsOfjNFVg7MBf19UDzX';
const audience  = 'https://api.communitytechaid.org.uk';
const scope     = 'openid profile email';
const cacheKey  = `@@auth0spajs@@::${clientId}::${audience}::${scope}`;

// Build the cache body — must match the CacheEntry shape the SDK saves after login.
// `decodedToken.user` is what isAuthenticated() ultimately checks (via getUser()).
// `decodedToken.claims.exp` is used by wrapCacheEntry to compute expiresAt.
// We use the access token claims as a stand-in since we have no ID token.
const cacheBody = {
  access_token: token,
  scope,
  expires_in: expiresIn,
  token_type: 'Bearer',
  audience,
  client_id: clientId,
  decodedToken: {
    claims,                  // must include .exp
    user: {                  // must be truthy; populate from well-known claims
      sub:   claims.sub,
      email: claims.email ?? claims['https://communitytechaid.org.uk/email'] ?? 'user@example.com',
      name:  claims.name  ?? claims.sub,
    },
    encoded: {
      header:    parts[0],
      payload:   parts[1],
      signature: parts[2],
    },
  },
};

// Outer wrapper shape: { body: CacheEntry, expiresAt: number }
// expiresAt = Math.min(now + expires_in, claims.exp) — both equal expiresAt here
const cacheValue = JSON.stringify({ body: cacheBody, expiresAt });

const storageState = {
  cookies: [],
  origins: [
    {
      origin: 'http://localhost:4200',
      localStorage: [
        { name: cacheKey, value: cacheValue },
      ],
    },
  ],
};

const outDir  = join(__dirname, '.auth');
const outPath = join(outDir, 'user.json');
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(storageState, null, 2));

console.log(`Saved storageState → ${outPath}`);
console.log('You can now run: npm run e2e');
