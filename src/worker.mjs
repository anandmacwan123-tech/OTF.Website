function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Max size of a stored submission payload (KV value limit is 25 MB).
const MAX_SUBMISSION_BYTES = 24 * 1024 * 1024;

// m2m100 language-code → language-name map. Workers AI expects the name.
const TR_LANG_NAMES = {
  hi: 'hindi', tl: 'tagalog', ig: 'igbo', vi: 'vietnamese',
  es: 'spanish', pt: 'portuguese', bg: 'bulgarian', fa: 'persian',
  sq: 'albanian', ru: 'russian', no: 'norwegian', pl: 'polish',
  az: 'azerbaijani', fr: 'french', tr: 'turkish', lt: 'lithuanian',
  it: 'italian',
};

async function sha1Hex(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function handleApi(request, env, url) {
  const kv = env.SUBMISSIONS;
  if (!kv) return json({ error: 'SUBMISSIONS KV namespace is not configured' }, 503);

  // Translate a batch of English strings into a cohort language.
  // Cached per (target, text) in the same KV namespace under `tr:` prefix.
  if (url.pathname === '/api/translate' && request.method === 'POST') {
    if (!env.AI) return json({ error: 'AI binding not configured' }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const target = body && typeof body.target === 'string' ? body.target : '';
    const texts = body && Array.isArray(body.texts) ? body.texts : null;
    if (!texts) return json({ error: 'Missing texts array' }, 400);
    if (texts.length > 200) return json({ error: 'Too many texts (max 200)' }, 413);
    const langName = TR_LANG_NAMES[target];
    if (!langName) {
      return json({ error: 'Unsupported target', supported: Object.keys(TR_LANG_NAMES) }, 400);
    }
    const out = new Array(texts.length).fill('');
    const keys = await Promise.all(texts.map((t) => sha1Hex(target + '\n' + t).then((h) => 'tr:' + target + ':' + h)));
    const cached = await Promise.all(keys.map((k) => kv.get(k)));
    for (let i = 0; i < texts.length; i++) {
      const input = typeof texts[i] === 'string' ? texts[i] : '';
      if (!input) { out[i] = ''; continue; }
      if (cached[i] != null) { out[i] = cached[i]; continue; }
      try {
        const res = await env.AI.run('@cf/meta/m2m100-1.2b', {
          text: input,
          source_lang: 'english',
          target_lang: langName,
        });
        const t = (res && (res.translated_text || res.text)) || input;
        out[i] = t;
        await kv.put(keys[i], t);
      } catch (err) {
        out[i] = input;
      }
    }
    return json({ translations: out });
  }

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
