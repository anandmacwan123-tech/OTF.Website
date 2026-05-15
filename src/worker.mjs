export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (/^\/students\/[^/]+\/?$/.test(url.pathname)) {
      return env.ASSETS.fetch(new URL('/students/', url.origin));
    }
    return env.ASSETS.fetch(request);
  }
};
