const COOKIE_NAME = 'files_auth';

function cookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function loginPage(error) {
  const msg = error ? `<p class="err">${error}</p>` : '';
  const body = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>OTF Library</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{background:#fff;font-family:'IBM Plex Sans',system-ui,sans-serif;color:#000;height:100%}
  body{display:flex;align-items:center;justify-content:center;padding:4vh 5vw;-webkit-font-smoothing:antialiased}
  form{display:flex;flex-direction:column;gap:1rem;width:100%;max-width:320px}
  label{font-size:0.6rem;letter-spacing:0.04em;text-transform:uppercase;color:#6a6a6a}
  input{width:100%;padding:0.6rem 0;background:none;border:0;border-bottom:1px solid rgba(0,0,0,0.15);font:inherit;font-size:1rem;letter-spacing:-0.01em;outline:none}
  button{margin-top:0.5rem;padding:0.6rem 1rem;background:#000;color:#fff;border:0;font:inherit;font-size:0.6rem;letter-spacing:0.04em;text-transform:uppercase;font-weight:500;cursor:pointer}
  .err{color:#FF002F;font-size:0.7rem;letter-spacing:0.04em;text-transform:uppercase}
</style>
</head><body>
<form method="POST" action="/files/login">
  <label for="p">OTF Library — password</label>
  <input id="p" name="password" type="password" autocomplete="current-password" autofocus required>
  ${msg}
  <button type="submit">Enter</button>
</form>
</body></html>`;
  return new Response(body, {
    status: error ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function handleFiles(request, env, url) {
  const expected = env.FILES_PASSWORD;
  if (!expected) {
    return new Response('FILES_PASSWORD is not configured', { status: 503 });
  }

  if (url.pathname === '/files/login' && request.method === 'POST') {
    const form = await request.formData();
    const password = form.get('password') || '';
    if (password === expected) {
      const secureFlag = url.protocol === 'https:' ? ' Secure;' : '';
      return new Response(null, {
        status: 303,
        headers: {
          'Location': '/files/',
          'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(expected)}; Path=/; Max-Age=2592000; HttpOnly;${secureFlag} SameSite=Lax`,
        },
      });
    }
    return loginPage('Incorrect password');
  }

  // Logout: clear cookie for both old Path=/files and new Path=/ then redirect.
  if (url.pathname === '/files/logout') {
    const secureFlag = url.protocol === 'https:' ? ' Secure;' : '';
    const clear = `${COOKIE_NAME}=; Max-Age=0; HttpOnly;${secureFlag} SameSite=Lax`;
    const headers = new Headers({ 'Location': '/files/' });
    headers.append('Set-Cookie', clear + '; Path=/');
    headers.append('Set-Cookie', clear + '; Path=/files');
    return new Response(null, { status: 303, headers });
  }

  // Redirect bare /files → /files/ so assets can find files/index.html
  if (url.pathname === '/files') {
    return Response.redirect(url.origin + '/files/', 301);
  }

  if (!isAdmin(request, env)) {
    return loginPage();
  }

  return env.ASSETS.fetch(request);
}

// True when the request carries a valid /files/ admin cookie.
function isAdmin(request, env) {
  const expected = env.FILES_PASSWORD;
  if (!expected) return false;
  const cookie = cookieValue(request.headers.get('Cookie'), COOKIE_NAME);
  return !!cookie && decodeURIComponent(cookie) === expected;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Max size of a stored submission payload (KV value limit is 25 MB).
const MAX_SUBMISSION_BYTES = 24 * 1024 * 1024;

// ── Submission API ───────────────────────────────────────────────────
// Students POST edits to /api/submit (gated by STUDENT_PASSWORD); the
// admin reviews/clears them from /files/ (gated by the FILES_PASSWORD
// cookie). Submissions are stored in the SUBMISSIONS KV namespace.
async function handleApi(request, env, url) {
  const kv = env.SUBMISSIONS;
  if (!kv) return json({ error: 'SUBMISSIONS KV namespace is not configured' }, 503);

  // Student-facing: submit a set of edits.
  if (url.pathname === '/api/submit' && request.method === 'POST') {
    const expected = env.STUDENT_PASSWORD;
    if (!expected) return json({ error: 'STUDENT_PASSWORD is not configured' }, 503);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    if (!payload || typeof payload !== 'object') {
      return json({ error: 'Invalid submission' }, 400);
    }
    if (payload.password !== expected) {
      return json({ error: 'Incorrect password' }, 403);
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

  // Everything below is admin-only.
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

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

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    if (url.pathname === '/files' || url.pathname.startsWith('/files/')) {
      return handleFiles(request, env, url);
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
