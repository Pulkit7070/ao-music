// What is actually playing right now, read from djay Pro.
//
// The DJ does not tell this page which track is on. `djay-monitor` watches
// djay Pro over the macOS Accessibility API and reports it; this polls that and
// the stage shows whatever it says. When the feed is off or unreachable, the
// head of the request queue stands in, so the page always has something to say.
//
// The one endpoint worth polling is /api/status: it carries the playing track,
// the cued track and both decks in a single response.
//
//   {
//     updatedAt: "2026-08-15T10:12:09.043Z",
//     djayRunning: true,
//     decks: { "1": { title, artist, elapsed, remaining, key, loaded, playing },
//              "2": { ... } },
//     playingDeck: 2 | null,
//     current:  { deck, title, artist, key, elapsed, remaining } | null,
//     upcoming: { deck, title, artist, key, elapsed, remaining } | null
//   }

const STORAGE_KEY = 'ao.disco.booth.url';

/**
 * Accept whatever is pasted in: the base address, /api/health or /api/status.
 * Tracks come from status, reachability from health, and one is derived from
 * the other so nobody has to know which is which.
 */
export function endpointsFor(url) {
  const text = String(url || '').trim().replace(/\/+$/, '');
  if (!text) return { status: '', health: '' };
  const base = text.replace(/\/api\/(status|health|current|upcoming)$/i, '');
  return { status: `${base}/api/status`, health: `${base}/api/health` };
}

export const CONFIG = {
  // djay-monitor, on the machine running djay Pro. Change it on the party page
  // or with ?booth=... in the address; whatever is set there is remembered.
  url: 'http://192.168.88.14:7474/api/status',

  // Anything the endpoint needs. Do not put a real secret here: this page is
  // readable by anyone who opens the tab.
  headers: {},

  // djay-monitor re-reads djay every 2 s by default, so asking more often than
  // that only adds traffic.
  pollSeconds: 3,
};

/** Pull the endpoint out of the address bar, then out of what was saved. */
export function resolveUrl(defaultUrl = CONFIG.url) {
  try {
    const fromQuery = new URLSearchParams(location.search).get('booth');
    if (fromQuery !== null) {
      const cleaned = fromQuery.trim();
      localStorage.setItem(STORAGE_KEY, cleaned);
      return cleaned;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved;
  } catch {
    // storage can be unavailable; the default is fine
  }
  return defaultUrl;
}

export function rememberUrl(url) {
  try {
    localStorage.setItem(STORAGE_KEY, String(url || '').trim());
  } catch {
    // nothing to do, the value still applies for this session
  }
}

function track(raw, deckFallback) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '').trim();
  if (!title) return null;
  return {
    title: title.slice(0, 120),
    artist: String(raw.artist || '').trim().slice(0, 120),
    remaining: String(raw.remaining || '').trim(),
    elapsed: String(raw.elapsed || '').trim(),
    key: String(raw.key || '').trim(),
    deck: raw.deck ?? deckFallback ?? null,
  };
}

/**
 * Map a /api/status body to what the page needs. This is the one function to
 * change if the API shape moves.
 */
export function normalise(body) {
  if (!body || typeof body !== 'object') return null;

  const decks = body.decks && typeof body.decks === 'object' ? body.decks : {};
  let current = track(body.current);
  let upcoming = track(body.upcoming);

  // Fall back to reading the decks directly, in case only the deck map is
  // populated: whichever deck is playing is current, a loaded one is next.
  if (!current) {
    for (const id of Object.keys(decks)) {
      if (decks[id] && decks[id].playing) {
        current = track(decks[id], Number(id));
        break;
      }
    }
  }
  if (!upcoming) {
    for (const id of Object.keys(decks)) {
      const deck = decks[id];
      if (deck && deck.loaded && !deck.playing && (!current || current.deck !== Number(id))) {
        upcoming = track(deck, Number(id));
        break;
      }
    }
  }

  return {
    running: Boolean(body.djayRunning),
    playingDeck: body.playingDeck ?? null,
    current,
    upcoming,
    // The monitor's own word for what djay is doing: playing, paused, and so
    // on. Better in front of the DJ than anything invented here.
    deckStatus: typeof body.status === 'string' ? body.status : '',
    updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : '',
  };
}

/**
 * Poll djay-monitor and report what changes.
 *
 * @returns {{ start(): void, stop(): void, configure(next: object): void,
 *   subscribe(cb: (state: object|null, status: string) => void): () => void,
 *   getState(): object|null, getStatus(): string, getUrl(): string,
 *   isEnabled(): boolean }}
 */
export function createNowPlaying(config = {}) {
  let settings = { ...CONFIG, url: resolveUrl(), ...config };
  let timer = 0;
  let state = null;
  let health = null;
  let reachable = false;
  let status = settings.url ? 'connecting' : 'off';
  const listeners = new Set();

  function announce() {
    for (const cb of listeners) {
      try {
        cb(state, status);
      } catch (error) {
        console.error('[ao-nowplaying] listener threw', error);
      }
    }
  }

  function setStatus(next) {
    if (status === next) return;
    status = next;
    announce();
  }

  /**
   * An https page cannot fetch an http address: the browser blocks it as mixed
   * content before the request leaves. Worth saying plainly, because the
   * failure otherwise looks like the API being down.
   */
  function blockedByMixedContent(url) {
    return location.protocol === 'https:' && /^http:\/\//i.test(url);
  }

  /**
   * Ask /api/health. It answers the question the status endpoint cannot: is the
   * monitor even up, and is djay running behind it. Returns a plain sentence,
   * because that is what ends up in front of the DJ.
   */
  async function checkHealth() {
    const { health: url } = endpointsFor(settings.url);
    if (!url) return { ok: false, note: 'no address set' };
    if (blockedByMixedContent(url)) {
      return { ok: false, note: 'blocked: this page is https and the monitor is http' };
    }
    try {
      const response = await fetch(url, { headers: settings.headers, cache: 'no-store' });
      if (!response.ok) return { ok: false, note: `monitor answered ${response.status}` };
      const body = await response.json();
      health = body;
      return {
        ok: Boolean(body && body.ok),
        djayRunning: Boolean(body && body.djayRunning),
        note: !body || !body.ok
          ? 'monitor is up but reports a problem'
          : body.djayRunning
            ? `monitor up, djay running, ${body.status || 'unknown'}`
            : 'monitor up, but djay Pro is not running',
      };
    } catch (error) {
      return { ok: false, note: `monitor unreachable: ${error.message}` };
    }
  }

  async function poll() {
    if (!settings.url) return;
    const { status: statusUrl } = endpointsFor(settings.url);
    if (blockedByMixedContent(statusUrl)) {
      reachable = false;
      setStatus('blocked: this page is https and the booth is http');
      return;
    }
    try {
      const response = await fetch(statusUrl, { headers: settings.headers, cache: 'no-store' });
      if (!response.ok) {
        reachable = false;
        setStatus(`error ${response.status}`);
        return;
      }
      reachable = true;
      const next = normalise(await response.json());
      const changed = JSON.stringify(next) !== JSON.stringify(state);
      state = next;
      status = !next ? 'unreadable response' : next.current ? 'live' : next.running ? 'djay idle' : 'djay not running';
      if (changed) announce();
    } catch (error) {
      // Unreachable, wrong network, or CORS. Ask health for the reason, and
      // keep the last known track rather than blanking the stage over one
      // failed request.
      reachable = false;
      const probe = await checkHealth();
      setStatus(probe.note || `unreachable: ${error.message}`);
    }
  }

  function start() {
    stop();
    if (!settings.url) {
      state = null;
      reachable = false;
      setStatus('off');
      return;
    }
    poll();
    timer = setInterval(poll, Math.max(1, settings.pollSeconds) * 1000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = 0;
  }

  return {
    start,
    stop,
    /** Point it somewhere else, and remember it for next time. */
    configure(next) {
      settings = { ...settings, ...next };
      if ('url' in next) rememberUrl(next.url);
      state = null;
      status = settings.url ? 'connecting' : 'off';
      start();
      announce();
    },
    subscribe(cb) {
      listeners.add(cb);
      cb(state, status);
      return () => listeners.delete(cb);
    },
    /** Probe /api/health on demand and report it in a sentence. */
    checkHealth,
    getHealth: () => health,
    /**
     * Did the last poll actually get an answer? When it did, the booth is the
     * authority on what is playing, including when the answer is "nothing".
     */
    isReachable: () => reachable,
    getState: () => state,
    getStatus: () => status,
    getUrl: () => settings.url,
    isEnabled: () => Boolean(settings.url),
  };
}

export default createNowPlaying;
