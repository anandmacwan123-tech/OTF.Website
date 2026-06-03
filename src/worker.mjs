function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Max size of a stored submission payload (KV value limit is 25 MB).
const MAX_SUBMISSION_BYTES = 24 * 1024 * 1024;

async function handleApi(request, env, url) {
  const kv = env.SUBMISSIONS;
  if (!kv) return json({ error: 'SUBMISSIONS KV namespace is not configured' }, 503);

  // Student-facing: submit a set of edits.
  if (url.pathname === '/api/submit' && request.method === 'POST') {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    if (!payload || typeof payload !== 'object') {
      return json({ error: 'Invalid submission' }, 400);
    }
    const student = typeof payload.student === 'string' ? payload.student.trim() : '';
    if (!student) return json({ error: 'Missing student' }, 400);

    const projects = Array.isArray(payload.projects) ? payload.projects : [];
    let imageCount = payload.headshot ? 1 : 0;
    for (const p of projects) {
      if (Array.isArray(p.images)) imageCount += p.images.length;
    }

    const record = {
      student,
      fullName: typeof payload.fullName === 'string' ? payload.fullName : student,
      bio: typeof payload.bio === 'string' ? payload.bio : '',
      practices: Array.isArray(payload.practices) ? payload.practices.slice(0, 3) : [],
      projects,
      headshot: payload.headshot || null,
      note: typeof payload.note === 'string' ? payload.note : '',
      createdAt: Date.now(),
    };

    const body = JSON.stringify(record);
    if (body.length > MAX_SUBMISSION_BYTES) {
      return json({ error: 'Submission too large — try fewer or smaller images' }, 413);
    }

    const id = 'sub:' + record.createdAt + '-' + crypto.randomUUID().slice(0, 8);
    await kv.put(id, body, {
      metadata: {
        student: record.student,
        fullName: record.fullName,
        createdAt: record.createdAt,
        projectCount: projects.length,
        imageCount,
      },
    });
    return json({ ok: true, id });
  }

  if (url.pathname === '/api/submissions' && request.method === 'GET') {
    const list = await kv.list({ prefix: 'sub:' });
    const items = list.keys
      .map(k => ({ id: k.name, ...(k.metadata || {}) }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return json({ items });
  }

  if (url.pathname === '/api/submission' && request.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    if (!id.startsWith('sub:')) return json({ error: 'Bad id' }, 400);
    const value = await kv.get(id);
    if (value == null) return json({ error: 'Not found' }, 404);
    return new Response(value, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (url.pathname === '/api/submission-delete' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const id = body && typeof body.id === 'string' ? body.id : '';
    if (!id.startsWith('sub:')) return json({ error: 'Bad id' }, 400);
    await kv.delete(id);
    return json({ ok: true });
  }

  if (url.pathname === '/api/submission-status' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const id = body && typeof body.id === 'string' ? body.id : '';
    const status = body && typeof body.status === 'string' ? body.status : '';
    if (!id.startsWith('sub:')) return json({ error: 'Bad id' }, 400);
    if (!['applied', 'denied'].includes(status)) return json({ error: 'Bad status' }, 400);
    const { value, metadata } = await kv.getWithMetadata(id);
    if (value == null) return json({ error: 'Not found' }, 404);
    let record;
    try { record = JSON.parse(value); } catch { return json({ error: 'Corrupt record' }, 500); }
    record.status = status;
    record.processedAt = Date.now();
    await kv.put(id, JSON.stringify(record), { metadata: { ...(metadata || {}), status } });
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Per-student subdomain: <student>.otf.show serves that student's
    // portfolio at the root. www and the apex fall through to normal
    // routing; the student page reads the slug from the hostname.
    const subMatch = url.hostname.match(/^([^.]+)\.otf\.show$/i);
    if (subMatch && subMatch[1].toLowerCase() !== 'www') {
      if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
      if (url.pathname === '/' || url.pathname === '') {
        return env.ASSETS.fetch(new URL('/students/', url.origin));
      }
      // Images, JSON and other assets are served as-is for this host.
      return env.ASSETS.fetch(request);
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    // /showcase/ moved to / on launch — keep shared links alive.
    if (url.pathname === '/showcase' || url.pathname === '/showcase/') {
      return Response.redirect(url.origin + '/', 301);
    }

    // /files/ is open — no password required.
    if (url.pathname === '/files') {
      return Response.redirect(url.origin + '/files/', 301);
    }

    // Per-student edit page — served from the shared /edit/ asset.
    if (/^\/students\/[^/]+\/edit\/?$/.test(url.pathname)) {
      return env.ASSETS.fetch(new URL('/edit/', url.origin));
    }

    if (/^\/students\/[^/]+\/?$/.test(url.pathname)) {
      return env.ASSETS.fetch(new URL('/students/', url.origin));
    }

    return env.ASSETS.fetch(request);
  }
};
