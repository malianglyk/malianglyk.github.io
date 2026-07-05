/**
 * Cloudflare Worker — Student Smart Planner
 *
 * - Serves the static React frontend (SPA)
 * - Handles /api/resources/web-search directly (Baidu API @ edge)
 * - Proxies all other /api/* → Railway backend
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

    // Handle Baidu web search directly at the edge (faster, no backend round-trip)
    if (path === '/api/resources/web-search' && request.method === 'POST') {
      return handleBaiduSearch(request, env);
    }

    // All other /api/* routes proxy to Railway backend
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

/**
 * Call Baidu Qianfan AppBuilder AI Search API directly from the edge.
 * API key format: bce-v3/ALTAK-xxx/yyy — used directly as Bearer token.
 */
async function handleBaiduSearch(request, env) {
  const baiduKey = env.BAIDU_API_KEY;
  if (!baiduKey) {
    return jsonResponse({ error: 'Baidu API key not configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const query = body.query;
  const count = body.count || 10;

  if (!query || query.trim().length === 0) {
    return jsonResponse({ error: 'Missing search query' }, 400);
  }

  try {
    const resp = await fetch('https://qianfan.baidubce.com/v2/ai_search/web_search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${baiduKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ content: query.trim(), role: 'user' }],
        search_source: 'baidu_search_v2',
        resource_type_filter: [{ type: 'web', top_k: Math.min(count, 20) }],
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      const items = data.references || data.resources || data.result || [];
      const results = items.map((r) => ({
        title: r.title || r.name || '',
        url: r.url || r.link || '',
        summary: (r.snippet || r.content || r.summary || '').substring(0, 300),
        kind: 'Web',
      }));
      return jsonResponse(results);
    }

    console.error('Baidu search failed:', resp.status, await resp.text().catch(() => ''));
    return jsonResponse([], 200);
  } catch (e) {
    console.error('Baidu search error:', e.message);
    return jsonResponse([], 200);
  }
}

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
