/**
 * Auth0 SPA client IDs, one per tier. Production builds use PROD_CLIENT_ID; every
 * non-production build (ng serve, uat-local, the deployed UAT site) uses DEV_CLIENT_ID,
 * so a login on a laptop or on UAT is never a login to the production application.
 * The source of truth is `auth_client_id` in src/environments/*.ts; these mirror it for
 * specs, which have to key the auth0-spa-js cache and the id_token `aud` on the same ID.
 */
export const PROD_CLIENT_ID = 'puJcT35DydtxJUsOfjNFVg7MBf19UDzX'; // TechAid Dashboard - Production
export const DEV_CLIENT_ID = 'ANqygfpxC0j2pEmErFb5rWOIUnfnkk5O'; // TechAid Dashboard - Dev & UAT
