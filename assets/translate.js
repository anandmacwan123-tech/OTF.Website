/* OTF hover-translation client.
   Reveals a translation when the user hovers any leaf text element.
   English-native students get an Anglo-Saxon transform; everyone else
   posts to /api/translate (Cloudflare Workers AI m2m100). */
(() => {
  if (window.OTFTranslate) return;

  const LANG_MAP = {
    Anand: 'hi', Becky: 'ang', Charles: 'tl', Darcy: 'ang',
    Divine: 'ig', Jaeden: 'ang', Jamie: 'vi', Jenna: 'ang',
    Jess: 'ang', Kaila: 'ang', Kami: 'es', Kye: 'ang',
    Martim: 'pt', Maseray: 'kri', Nikol: 'bg', Noora: 'fa',
    Nora: 'sq', Nuria: 'es', Olya: 'ru', Oscar: 'no',
    Rebecca: 'fj', Sam: 'ang', Sara: 'pl', Sasha: 'ang',
    Sebastian: 'ang', Shalom: 'kri', Surayya: 'az', Taleb: 'fr',
    Tallulah: 'ang', Vanessa: 'tr', Will: 'ang', Emily: 'ak',
    Carolina: 'pt', Arnete: 'lt', Oli: 'ang', Valentina: 'it',
    Elise: 'ang', David: 'ang', Adam: 'ang', Callum: 'ang',
  };

  // m2m100-1.2b codes our cohort uses. Unlisted codes (kri, fj, ak) skip the API.
  const API_SUPPORTED = new Set([
    'hi', 'tl', 'ig', 'vi', 'es', 'pt', 'bg', 'fa', 'sq',
    'ru', 'no', 'pl', 'az', 'fr', 'tr', 'lt', 'it',
  ]);

  // Lowercase, single-word substitutions only. Multi-word and possessives
  // first so they don't get stomped by the single-word rules below.
  const OE_RULES = [
    [/\byou are\b/gi, 'þū eart'],
    [/\bi am\b/gi, 'ic eom'],
    [/\bi'm\b/gi, 'ic eom'],
    [/\byou're\b/gi, 'þū eart'],
    [/\bthat is\b/gi, 'þæt is'],
    [/\bthank you\b/gi, 'þancie þē'],
    [/\bgood night\b/gi, 'gōde niht'],
    [/\bgood morning\b/gi, 'gōdne morgen'],
    [/\bbook your\b/gi, 'gebōc þīn'],
  ];
  const OE_WORDS = {
    you: 'þū', your: 'þīn', yours: 'þīn', yourself: 'þē sylf',
    the: 'þæt', and: 'ond', of: 'of', is: 'biþ', are: 'sind',
    was: 'wæs', were: 'wǣron', be: 'bēon', been: 'gebēon',
    my: 'mīn', mine: 'mīn', me: 'mē', we: 'wē', us: 'ūs',
    our: 'ūre', ours: 'ūre', i: 'ic',
    hello: 'hāl', hi: 'hāl', welcome: 'wilcuma', book: 'bōc',
    ticket: 'getæl', tickets: 'getælu',
    good: 'gōd', night: 'niht', day: 'dæg', year: 'gēar',
    world: 'weorold', home: 'hām', friend: 'frēond',
    design: 'cræft', designer: 'cræftiga', graphic: 'awriten',
    show: 'scēawung', showcase: 'scēawung-cæste',
    student: 'leorningcniht', students: 'leorningcnihtas',
    index: 'leornung-gewrit', visit: 'fērclyppan', info: 'cwide',
    search: 'sēcan', open: 'openian', close: 'lūcan',
    portfolio: 'cræft-gewrit', instagram: 'andwlitanbōc',
    linkedin: 'gemǣne-bend', portrait: 'andwlita',
    next: 'næst', previous: 'ǣrer', back: 'ongēan',
    here: 'hēr', there: 'þǣr', now: 'nū',
    bio: 'lifgewrit', name: 'nama', work: 'weorc',
    free: 'frēo', entry: 'ingang', show_: 'scēawung',
    london: 'Lundene', university: 'lār-hūs', june: 'sēre-mōnaþ',
    invited: 'gelaþod', invite: 'laþung',
    practice: 'cræft', practices: 'cræftas',
    project: 'weorc', projects: 'weorca',
    save: 'gehealdan', loading: 'fērende',
  };

  function preserveCase(orig, sub) {
    if (!orig) return sub;
    if (orig === orig.toUpperCase()) return sub.toUpperCase();
    if (orig[0] === orig[0].toUpperCase()) return sub[0].toUpperCase() + sub.slice(1);
    return sub;
  }

  function oldEnglish(text) {
    if (!text) return text;
    let out = text;
    for (const [re, sub] of OE_RULES) out = out.replace(re, sub);
    out = out.replace(/[A-Za-z']+/g, (w) => {
      const k = w.toLowerCase();
      const sub = OE_WORDS[k];
      return sub ? preserveCase(w, sub) : w;
    });
    return out;
  }

  // Block elements whose direct children carry meaning of their own.
  const BLOCK_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS',
    'VIDEO', 'AUDIO', 'PICTURE', 'IMG', 'INPUT', 'TEXTAREA', 'SELECT',
  ]);

  // Walk scope and return leaf elements containing non-empty text and no
  // element children — these are safe to swap textContent on.
  function collectTranslatable(scope) {
    const out = [];
    const stack = [scope];
    while (stack.length) {
      const el = stack.pop();
      if (!el || el.nodeType !== 1) continue;
      if (BLOCK_TAGS.has(el.tagName)) continue;
      if (el.hasAttribute('data-no-tr')) continue;
      const kids = el.children;
      if (kids.length === 0) {
        const txt = (el.textContent || '').trim();
        if (txt && /[A-Za-z]/.test(txt)) out.push(el);
        continue;
      }
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return out;
  }

  // Cache of translations keyed by `${lang}\n${text}`. Survives multiple
  // translateScope calls on the same page.
  const memo = new Map();
  const inflight = new Map();

  async function fetchBatch(texts, lang) {
    const key = (t) => lang + '\n' + t;
    const needed = [];
    for (const t of texts) {
      const k = key(t);
      if (memo.has(k) || inflight.has(k)) continue;
      needed.push(t);
    }
    if (needed.length) {
      // Chunk to keep request size sane.
      const chunks = [];
      for (let i = 0; i < needed.length; i += 100) chunks.push(needed.slice(i, i + 100));
      const promise = (async () => {
        for (const chunk of chunks) {
          try {
            const res = await fetch('/api/translate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ texts: chunk, target: lang }),
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const arr = Array.isArray(data.translations) ? data.translations : [];
            chunk.forEach((t, i) => memo.set(key(t), arr[i] || t));
          } catch (err) {
            console.debug('[OTFTranslate] batch failed', err);
            chunk.forEach((t) => memo.set(key(t), t));
          }
        }
      })();
      needed.forEach((t) => inflight.set(key(t), promise));
      await promise;
      needed.forEach((t) => inflight.delete(key(t)));
    } else {
      // Wait on whichever inflight requests cover these texts.
      const waits = [];
      for (const t of texts) {
        const p = inflight.get(key(t));
        if (p) waits.push(p);
      }
      if (waits.length) await Promise.all(waits);
    }
    return texts.map((t) => memo.get(key(t)) || t);
  }

  function langFor(slug) {
    if (!slug) return null;
    return LANG_MAP[slug] || null;
  }

  function attach(el, original, translated) {
    if (!translated) translated = original;
    if (el.dataset.trBound) {
      el.dataset.trEn = original;
      el.dataset.trText = translated;
      return;
    }
    if (translated === original) return;
    el.dataset.trEn = original;
    el.dataset.trText = translated;
    el.dataset.trBound = '1';
    el.setAttribute('data-tr-ready', '');
    const show = () => { el.textContent = el.dataset.trText || el.textContent; };
    const hide = () => { el.textContent = el.dataset.trEn || el.textContent; };
    el.addEventListener('mouseenter', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focusin', show);
    el.addEventListener('focusout', hide);
  }

  // Translate one element with a known lang. Used for dynamically-added
  // labels (showcase headshot label, faces grid).
  async function translateElement(el, lang) {
    if (!el || !lang) return;
    const original = (el.textContent || '').trim();
    if (!original || !/[A-Za-z]/.test(original)) return;
    if (lang === 'ang') {
      attach(el, original, oldEnglish(original));
      return;
    }
    if (!API_SUPPORTED.has(lang)) return;
    const [t] = await fetchBatch([original], lang);
    attach(el, original, t);
  }

  /* translateScope({ scope, lang, perElementLangAttr })
       scope             — root element to walk (default body)
       lang              — fallback target lang for elements without an override
       perElementLangAttr — if set (e.g. "data-tr-lang"), each element's
                            attribute value is treated as a student slug whose
                            language overrides the scope-level lang. */
  async function translateScope({ scope, lang, perElementLangAttr } = {}) {
    const root = scope || document.body;
    if (!root) return;

    const elements = collectTranslatable(root);
    const byLang = new Map();
    for (const el of elements) {
      let elLang = lang;
      if (perElementLangAttr) {
        const slug = el.closest('[' + perElementLangAttr + ']');
        if (slug) {
          const found = langFor(slug.getAttribute(perElementLangAttr));
          if (found) elLang = found;
        }
      }
      if (!elLang) continue;
      if (!byLang.has(elLang)) byLang.set(elLang, []);
      byLang.get(elLang).push(el);
    }

    // Handle 'ang' synchronously and any unsupported langs are dropped.
    for (const [l, els] of byLang) {
      if (l === 'ang') {
        for (const el of els) {
          const original = (el.textContent || '').trim();
          attach(el, original, oldEnglish(original));
        }
        byLang.delete(l);
      } else if (!API_SUPPORTED.has(l)) {
        console.debug('[OTFTranslate] unsupported lang', l);
        byLang.delete(l);
      }
    }

    // Remaining are API-backed. Fire off in parallel by lang.
    await Promise.all([...byLang.entries()].map(async ([l, els]) => {
      const originals = els.map((el) => (el.textContent || '').trim());
      const translations = await fetchBatch(originals, l);
      els.forEach((el, i) => attach(el, originals[i], translations[i]));
    }));
  }

  function pickCohortLang() {
    const pool = [...new Set(Object.values(LANG_MAP))]
      .filter((l) => l === 'ang' || API_SUPPORTED.has(l));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  window.OTFTranslate = {
    LANG_MAP,
    API_SUPPORTED,
    oldEnglish,
    translateScope,
    translateElement,
    pickCohortLang,
    langFor,
  };
})();
