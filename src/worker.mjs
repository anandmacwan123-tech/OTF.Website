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
          'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(expected)}; Path=/files; Max-Age=2592000; HttpOnly;${secureFlag} SameSite=Lax`,
        },
      });
    }
    return loginPage('Incorrect password');
  }

  // Redirect bare /files → /files/ so assets can find files/index.html
  if (url.pathname === '/files') {
    return Response.redirect(url.origin + '/files/', 301);
  }

  const cookie = cookieValue(request.headers.get('Cookie'), COOKIE_NAME);
  if (!cookie || decodeURIComponent(cookie) !== expected) {
    return loginPage();
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/files' || url.pathname.startsWith('/files/')) {
      return handleFiles(request, env, url);
    }

    if (/^\/students\/[^/]+\/?$/.test(url.pathname)) {
      return env.ASSETS.fetch(new URL('/students/', url.origin));
    }

    return env.ASSETS.fetch(request);
  }
};
