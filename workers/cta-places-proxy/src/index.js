const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/autocomplete') {
      const input = url.searchParams.get('input');
      if (!input) return new Response('Missing input', { status: 400, headers: CORS_HEADERS });

      const upstream = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
      upstream.searchParams.set('input', input);
      upstream.searchParams.set('key', env.GOOGLE_API_KEY);
      upstream.searchParams.set('language', 'en');
      upstream.searchParams.set('components', 'country:gb');

      const resp = await fetch(upstream.toString());
      const body = await resp.text();
      return new Response(body, {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/details') {
      const placeId = url.searchParams.get('place_id');
      if (!placeId) return new Response('Missing place_id', { status: 400, headers: CORS_HEADERS });

      const upstream = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      upstream.searchParams.set('place_id', placeId);
      upstream.searchParams.set('fields', 'address_components,formatted_address,name');
      upstream.searchParams.set('key', env.GOOGLE_API_KEY);
      upstream.searchParams.set('language', 'en');

      const resp = await fetch(upstream.toString());
      const body = await resp.text();
      return new Response(body, {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
