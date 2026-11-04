#!/usr/bin/env node
/**
 * Prints a synthetic-but-well-formed Auth0 access token for the @mocked suite.
 *
 * Fake credentials, real format: auth0-spa-js never re-verifies the signature of a *cached*
 * token (only structure and expiry) and every GraphQL call in @mocked specs is page.route-stubbed.
 *
 * The token carries the STAFF permission set (e2e/helpers/staff-permissions.json — what a fully
 * privileged ADMINISTRATOR+CAN_DELETE user holds), so a spec that does not care about
 * permissions behaves like a staff member and is not broken when a new UI gate lands. A spec
 * that tests denial must NOT rely on this default: it calls loginWith(page, [...]) with an
 * explicit permission list (see e2e/helpers/auth0-cache.ts).
 *
 * Usage (CI and locally):
 *   E2E_BEARER_TOKEN="$(node e2e/mint-fake-token.mjs)" node e2e/save-token.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const permissions = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'staff-permissions.json'), 'utf8'),
);
const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const payload = {
  iss: 'https://techaid-auth.eu.auth0.com/',
  sub: 'auth0|ci-fake-user',
  aud: ['https://api.communitytechaid.org.uk'],
  iat: now,
  exp: now + 7200,
  scope: 'openid profile email offline_access',
  'https://communitytechaid.org.uk/email': 'ci@example.com',
  'https://communitytechaid.org.uk/name': 'CI Fake User',
  permissions,
};
console.log(`${b64url({ alg: 'RS256', typ: 'JWT', kid: 'ci-fake' })}.${b64url(payload)}.ci_fake_signature`);
