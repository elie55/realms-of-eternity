const CACHE = 'realms-of-eternity-v13b-attacks-pages';
const ART = 'realms-of-eternity-art-v9'; // new name: purges any picture cached by older versions
// v12d: the battle UI kit (same list as src/ui/duelAssets.js BATTLE_KIT + BATTLE_BG; a test keeps them in sync)
const BATTLE_KIT = [
  '/realms-of-eternity/art/backs/gold-gem-360.webp', '/realms-of-eternity/ui/bd/stall.webp', '/realms-of-eternity/ui/bd/coin.webp', '/realms-of-eternity/ui/bd/deck.webp', '/realms-of-eternity/ui/bd/grave.webp', '/realms-of-eternity/ui/bd/log.webp', '/realms-of-eternity/ui/bd/flag.webp',
  '/realms-of-eternity/ui/shop/shop-button.webp', '/realms-of-eternity/ui/shop/battle-coin.webp',
  '/realms-of-eternity/ui/kit/faction-arcane.webp', '/realms-of-eternity/ui/kit/faction-celestial.webp', '/realms-of-eternity/ui/kit/faction-inferno.webp', '/realms-of-eternity/ui/kit/faction-iron.webp', '/realms-of-eternity/ui/kit/faction-neutral.webp', '/realms-of-eternity/ui/kit/faction-shadow.webp', '/realms-of-eternity/ui/kit/faction-verdant.webp',
  '/realms-of-eternity/ui/kit/badge-sleep.webp', '/realms-of-eternity/ui/kit/icon-poison.webp', '/realms-of-eternity/ui/kit/icon-deck.webp', '/realms-of-eternity/ui/kit/icon-aegis.webp',
  '/realms-of-eternity/ui/token-divine.webp', '/realms-of-eternity/ui/token-guardian.webp', '/realms-of-eternity/ui/token-stealth-smoke.webp',
  '/realms-of-eternity/ui/kw/kw-aoe.webp', '/realms-of-eternity/ui/kw/kw-resurrect.webp', '/realms-of-eternity/ui/kw/kw-tenacity.webp', '/realms-of-eternity/ui/kw/kw-vampirism.webp',
  '/realms-of-eternity/ui/bd/bgD-land.webp', '/realms-of-eternity/ui/bd/bgD-port.webp', '/realms-of-eternity/ui/board-verdant.webp', '/realms-of-eternity/ui/board-portrait.webp',
];
const SHELL = ['/realms-of-eternity/', '/realms-of-eternity/index.html', '/realms-of-eternity/manifest.webmanifest', '/realms-of-eternity/fonts/LilitaOne-Regular.woff2', '/realms-of-eternity/fonts/Fredoka-Variable.woff2'];
// Immutable art (cards, fx, ui, hashed build assets) is cache-first, so the game keeps every picture
// even when the tunnel host rotates or drops a request; everything else stays network-first.
const IMMUTABLE = /^\/realms-of-eternity\/(cards|fx|ui|art|icons|fonts|assets)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

// The free tunnel answers browser sub-requests with its HTML "caution" page (status 200!) unless this
// header is present; the worker adds it to every same-origin sub-request so pictures always arrive.
function net(req) {
  if (typeof req === 'string') req = new Request(req);
  if (req.mode === 'navigate') return fetch(req);
  const headers = new Headers(req.headers);
  headers.set('X-Pinggy-No-Screen', 'true');
  return fetch(req.url, { headers, credentials: 'same-origin', cache: 'no-store', redirect: 'follow' });
}

async function warmArt() {
  // Background-precache every card picture so the Collection (owned and missing cards) never needs the network.
  try {
    const res = await net('/realms-of-eternity/art-index.json');
    if (!res.ok) return;
    const index = await res.json();
    const cache = await caches.open(ART);
    const urls = (index.cards || []).map((id) => `/realms-of-eternity/cards/${id}.webp`);
    await new Promise((r) => setTimeout(r, 5000));
    for (let i = 0; i < urls.length; i += 2) {
      await yieldToPage();
      await Promise.all(urls.slice(i, i + 2).map(async (url) => {
        if (await cache.match(url)) return;
        try { const r = await net(url); if (looksRight(new URL(url, self.location.origin), r)) await cache.put(url, r); } catch {}
      }));
    }
  } catch {}
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== ART).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
  warmKit().then(warmArt);
});

// v12f: the page pauses this background precache while a duel's first board is loading (it would
// compete for a slow connection); a pause expires on its own after 12 s in case "resume" never comes.
let pausedUntil = 0;
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type !== 'roe-warm') return;
  pausedUntil = d.pause ? Date.now() + 12000 : 0;
});
const yieldToPage = async () => { while (Date.now() < pausedUntil) await new Promise((r) => setTimeout(r, 150)); };

async function warmKit() {
  // v12d: precache the battle kit right away (small), before the slower card-art warm-up.
  try {
    const cache = await caches.open(CACHE);
    for (const url of BATTLE_KIT) {
      await yieldToPage();
      if (await cache.match(url)) continue;
      try { const r = await net(url); if (looksRight(new URL(url, self.location.origin), r)) await cache.put(url, r); } catch {}
    }
  } catch {}
}

const looksRight = (url, res) => {
  if (!res || res.status !== 200 || res.type === 'opaque' || res.type === 'opaqueredirect') return false;
  const type = res.headers.get('content-type') || '';
  // A tunnel / proxy page (HTML) must never be stored or served in place of a picture.
  if (/\.(webp|png|jpe?g|svg|gif)$/i.test(url.pathname)) return type.startsWith('image/');
  return true;
};

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith((async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (looksRight(url, hit)) return hit;
      try {
        const res = await net(req);
        if (looksRight(url, res)) {
          const copy = res.clone();
          caches.open(url.pathname.startsWith('/realms-of-eternity/cards/') ? ART : CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      } catch (err) {
        return Response.error();
      }
    })());
    return;
  }
  event.respondWith(
    net(req)
      .then((res) => {
        if (looksRight(url, res)) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      // Only page navigations fall back to the app shell; a missing file is a real error, never HTML.
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/realms-of-eternity/') : Response.error()))),
  );
});
