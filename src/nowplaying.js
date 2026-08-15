// What is actually playing right now.
//
// The DJ should not have to tell the page which track is on. When the API is
// available this polls it and the stage shows whatever it reports; until then
// it stays switched off and the queue drives the display, which is the current
// behaviour unchanged.
//
// ---------------------------------------------------------------------------
// TO CONNECT THE API, EDIT THIS BLOCK. Nothing else needs to change.
// ---------------------------------------------------------------------------
export const CONFIG = {
  // The endpoint that reports the current track. Null keeps the feed off.
  // Example: 'https://api.example.com/v1/now-playing'
  url: null,

  // Anything the endpoint needs, e.g. { Authorization: 'Bearer abc123' }.
  // Do not put a secret here if this page is ever served publicly: it is
  // readable by anyone who opens the tab.
  headers: {},

  // How often to ask, in seconds. Most now-playing APIs are rate limited, and
  // a track change does not need to land in under a second.
  pollSeconds: 10,

  // The endpoint must send CORS headers that allow this origin, or the browser
  // will block the response before this code ever sees it.
};

/**
 * Map a response body to the shape the page uses. The real API shape is not
 * known yet, so this accepts the handful of spellings these endpoints usually
 * use and is the single place to adjust when the contract arrives.
 *
 * Wanted shape:
 *   { title: string, artist?: string, url?: string, playing?: boolean }
 */
export function normalise(body) {
  if (!body || typeof body !== 'object') return null;
  // Some APIs wrap the track, e.g. { item: {...} } or { data: { track: {...} } }
  const track = body.track || body.item || body.nowPlaying || body.now_playing || body.data || body;
  if (!track || typeof track !== 'object') return null;

  const title = track.title || track.name || track.song || '';
  if (!title) return null;

  const artistField = track.artist || track.artists || track.artistName || '';
  const artist = Array.isArray(artistField)
    ? artistField.map((a) => (typeof a === 'string' ? a : a && a.name)).filter(Boolean).join(', ')
    : String(artistField || '');

  const playing = track.playing ?? track.isPlaying ?? track.is_playing ?? true;

  return {
    title: String(title).slice(0, 120),
    artist: artist.slice(0, 120),
    url: typeof track.url === 'string' ? track.url : typeof track.link === 'string' ? track.link : '',
    playing: Boolean(playing),
  };
}

/**
 * Poll the endpoint and report changes.
 *
 * @param {object} [config] overrides for CONFIG, so a caller can point it
 *   somewhere else at runtime without editing this file
 * @returns {{ start(): void, stop(): void, configure(next: object): void,
 *   subscribe(cb: (track: object|null, status: string) => void): () => void,
 *   getTrack(): object|null, getStatus(): string, isEnabled(): boolean }}
 */
export function createNowPlaying(config = {}) {
  let settings = { ...CONFIG, ...config };
  let timer = 0;
  let track = null;
  let status = settings.url ? 'idle' : 'off';
  const listeners = new Set();

  function announce() {
    for (const cb of listeners) {
      try {
        cb(track, status);
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

  async function poll() {
    if (!settings.url) return;
    try {
      const response = await fetch(settings.url, {
        headers: settings.headers,
        cache: 'no-store',
      });
      if (!response.ok) {
        setStatus(`error ${response.status}`);
        return;
      }
      const next = normalise(await response.json());
      const changed = JSON.stringify(next) !== JSON.stringify(track);
      track = next;
      status = next ? 'live' : 'nothing playing';
      if (changed) announce();
    } catch (error) {
      // Network failure, CORS, or a body that is not JSON. Keep the last known
      // track rather than blanking the stage on one bad request.
      setStatus(`unreachable: ${error.message}`);
    }
  }

  function start() {
    stop();
    if (!settings.url) {
      setStatus('off');
      return;
    }
    poll();
    timer = setInterval(poll, Math.max(2, settings.pollSeconds) * 1000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = 0;
  }

  return {
    start,
    stop,
    /** Point it at an endpoint at runtime, e.g. from the browser console. */
    configure(next) {
      settings = { ...settings, ...next };
      track = null;
      start();
      announce();
    },
    subscribe(cb) {
      listeners.add(cb);
      cb(track, status);
      return () => listeners.delete(cb);
    },
    getTrack: () => track,
    getStatus: () => status,
    isEnabled: () => Boolean(settings.url),
  };
}

export default createNowPlaying;
