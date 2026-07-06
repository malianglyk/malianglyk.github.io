/**
 * Cloudflare Worker — Student Smart Planner
 *
 * - Serves the static React frontend (SPA)
 * - Proxies all /api/* → Railway backend
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // All /api/* routes proxy to Railway backend
    if (path.startsWith('/api/')) {
      return proxyToBackend(request, env);
    }

    // Serve static frontend (SPA)
    try {
      return await env.ASSETS.fetch(request);
    } catch (e) {
      try {
        const indexReq = new Request(new URL('/index.html', request.url), request);
        return await env.ASSETS.fetch(indexReq);
      } catch (e2) {
        return new Response('Not Found', { status: 404 });
      }
    }
  },
};


async function proxyToBackend(request, env) {
  const backendUrl = env.BACKEND_URL || 'https://backend-production-7f89.up.railway.app';
  const url = new URL(request.url);
  const targetUrl = backendUrl + url.pathname + url.search;

  const headers = new Headers(request.headers);
  headers.delete('Origin');
  headers.delete('Referer');
  headers.set('Host', new URL(backendUrl).host);
  for (const key of headers.keys()) {
    if (key.startsWith('cf-')) headers.delete(key);
  }

  try {
    const proxyResp = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD'
        ? await request.arrayBuffer()
        : undefined,
    });
    const respHeaders = new Headers(proxyResp.headers);
    respHeaders.set('Access-Control-Allow-Origin', '*');
    return new Response(proxyResp.body, {
      status: proxyResp.status,
      headers: respHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Backend unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
