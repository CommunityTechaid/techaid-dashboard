// Proxies Google Places autocomplete/details for the techaid-dashboard address
// fields (admin formly `place` type and the public delivery-booking form),
// keeping the billed GOOGLE_API_KEY server-side.
//
// Hardening (2026-07-19):
// - Origin allowlist: only the dashboard origins get CORS approval, and requests
//   without an allowlisted Origin are rejected outright. Every legitimate caller
//   is a cross-origin browser fetch, so a real Origin header is always present.
//   (Origin is forgeable by scripts — the rate limit below is the backstop.)
// - Per-IP rate limit via the Workers rate-limiting binding: generous enough for
//   a debounced autocomplete (300ms debounce, min 3 chars) even behind the
//   shared office NAT, but kills quota-burning scripts. 429s carry CORS headers
//   so the dashboard's catchError degrades to "no suggestions" silently.

const ALLOWED_ORIGINS = [
  'https://app.communitytechaid.org.uk',
  'https://app-testing.communitytechaid.org.uk',
  'http://localhost:4200', // ng serve / e2e dev server
];

const MAX_INPUT_LENGTH = 100;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return new Response('Too many requests', { status: 429, headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname === '/autocomplete') {
      const input = url.searchParams.get('input');
      if (!input) return new Response('Missing input', { status: 400, headers: cors });
      if (input.length > MAX_INPUT_LENGTH) {
        return new Response('Input too long', { status: 400, headers: cors });
      }
      const upstream = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
      upstream.searchParams.set('input', input);
      upstream.searchParams.set('key', env.GOOGLE_API_KEY);
      upstream.searchParams.set('language', 'en');
      upstream.searchParams.set('components', 'country:gb');
      const resp = await fetch(upstream.toString());
      const body = await resp.text();
      return new Response(body, {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/details') {
      const placeId = url.searchParams.get('place_id');
      if (!placeId) return new Response('Missing place_id', { status: 400, headers: cors });
      const upstream = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      upstream.searchParams.set('place_id', placeId);
      upstream.searchParams.set('fields', 'address_components,formatted_address,name');
      upstream.searchParams.set('key', env.GOOGLE_API_KEY);
      upstream.searchParams.set('language', 'en');
      const resp = await fetch(upstream.toString());
      const body = await resp.text();
      return new Response(body, {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};
