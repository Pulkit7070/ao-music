// Spotify as a source of "what is playing".
//
// Authorization Code with PKCE, which is the flow for a page with no backend:
// no client secret is involved, so nothing secret ships to the browser. The
// user presses one button, approves once, and the page can then ask Spotify
// what is on.
//
// What Spotify will and will not give us, which shapes everything below:
//
//   it gives   the track, the artists, whether it is playing, and how far in
//              we are, to the millisecond
//   it will not give the tempo or the beats. /audio-features and
//              /audio-analysis were switched off for new apps in November 2024
//              and answer 403, with no replacement.
//
// So Spotify tells the page what is on and when it starts and stops; the beat
// itself comes from the microphone if it is listening, and otherwise from the
// generated pulse in pulse.js. Same as the booth feed.

const AUTH_HOST = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const SCOPE = 'user-read-currently-playing user-read-playback-state';

const VERIFIER_KEY = 'ao.disco.spotify.verifier';
const TOKEN_KEY = 'ao.disco.spotify.token';

function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode; the session still works, it just will not survive a reload
  }
}

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Random string for the PKCE verifier. */
function randomString(length = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

/**
 * The address Spotify sends the user back to. It has to match one of the
 * Redirect URIs registered on the Spotify app exactly, character for character.
 */
export function redirectUri() {
  return location.origin + location.pathname;
}

/**
 * @param {object} opts
 * @param {string} opts.clientId from the Spotify developer dashboard
 * @param {number} [opts.pollSeconds=3]
 */
export function createSpotify({ clientId, pollSeconds = 3 } = {}) {
  let token = read(TOKEN_KEY);
  let state = null;
  let status = clientId ? 'not connected' : 'no client id';
  let timer = 0;
  const listeners = new Set();

  const announce = () => {
    for (const cb of listeners) {
      try {
        cb(state, status);
      } catch (error) {
        console.error('[ao-spotify] listener threw', error);
      }
    }
  };

  const setStatus = (next) => {
    if (status === next) return;
    status = next;
    announce();
  };

  function isConnected() {
    return Boolean(token && token.refresh_token);
  }

  // -- auth -------------------------------------------------------------------

  async function connect() {
    if (!clientId) {
      setStatus('no client id');
      return;
    }
    const verifier = randomString();
    store(VERIFIER_KEY, verifier);
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri(),
      code_challenge_method: 'S256',
      code_challenge: await challengeFor(verifier),
      state: randomString(16),
      scope: SCOPE,
    });
    location.assign(`${AUTH_HOST}/authorize?${params}`);
  }

  /** PKCE token calls carry no Authorization header at all. */
  async function tokenRequest(body) {
    const response = await fetch(`${AUTH_HOST}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    const parsed = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(parsed.error_description || parsed.error || `token ${response.status}`);
    return parsed;
  }

  /**
   * Called on load. If Spotify has just sent the user back with a code, trade
   * it for a token and tidy the address bar so a refresh cannot replay it.
   */
  async function completeSignIn() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const error = params.get('error');
    if (error) {
      setStatus(`Spotify refused: ${error}`);
      cleanUrl();
      return false;
    }
    if (!code) return false;

    const verifier = read(VERIFIER_KEY);
    cleanUrl();
    if (!verifier) {
      setStatus('sign in did not complete, try again');
      return false;
    }
    try {
      const granted = await tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: clientId,
        code_verifier: verifier,
      });
      keep(granted);
      store(VERIFIER_KEY, null);
      setStatus('connected');
      start();
      return true;
    } catch (err) {
      setStatus(`could not finish sign in: ${err.message}`);
      return false;
    }
  }

  function cleanUrl() {
    const url = new URL(location.href);
    for (const key of ['code', 'state', 'error']) url.searchParams.delete(key);
    history.replaceState({}, '', url.toString());
  }

  function keep(granted) {
    token = {
      access_token: granted.access_token,
      // a refresh response does not always carry a new refresh token
      refresh_token: granted.refresh_token || (token && token.refresh_token),
      expires_at: Date.now() + (granted.expires_in || 3600) * 1000 - 30_000,
    };
    store(TOKEN_KEY, token);
  }

  async function freshToken() {
    if (!token) return null;
    if (token.access_token && Date.now() < token.expires_at) return token.access_token;
    if (!token.refresh_token) return null;
    const granted = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      client_id: clientId,
    });
    keep(granted);
    return token.access_token;
  }

  function disconnect() {
    token = null;
    state = null;
    store(TOKEN_KEY, null);
    stop();
    setStatus('not connected');
    announce();
  }

  // -- what is playing --------------------------------------------------------

  function shape(body) {
    if (!body || !body.item) return { running: true, current: null, upcoming: null, deckStatus: 'nothing playing' };
    const item = body.item;
    const artist = Array.isArray(item.artists)
      ? item.artists.map((a) => a && a.name).filter(Boolean).join(', ')
      : '';
    const left = Math.max(0, (item.duration_ms || 0) - (body.progress_ms || 0));
    const mmss = (ms) => {
      const total = Math.round(ms / 1000);
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    };
    return {
      running: true,
      playingDeck: null,
      current: body.is_playing
        ? {
            title: String(item.name || '').slice(0, 120),
            artist: artist.slice(0, 120),
            remaining: `-${mmss(left)}`,
            elapsed: mmss(body.progress_ms || 0),
            art: item.album && item.album.images && item.album.images[0] ? item.album.images[0].url : '',
            deck: null,
          }
        : null,
      upcoming: null,
      deckStatus: body.is_playing ? 'playing' : 'paused',
    };
  }

  async function poll() {
    if (!isConnected()) return;
    try {
      const access = await freshToken();
      if (!access) {
        setStatus('sign in expired, connect again');
        return;
      }
      const response = await fetch(`${API}/me/player/currently-playing`, {
        headers: { Authorization: `Bearer ${access}` },
        cache: 'no-store',
      });
      // 204 means Spotify is open but nothing is on any device.
      if (response.status === 204) {
        state = { running: true, current: null, upcoming: null, deckStatus: 'nothing playing' };
        setStatus('connected, nothing playing');
        announce();
        return;
      }
      if (response.status === 401) {
        token = { ...token, expires_at: 0 };
        return;
      }
      if (response.status === 429) {
        setStatus('Spotify is rate limiting, slowing down');
        return;
      }
      if (!response.ok) {
        setStatus(`Spotify answered ${response.status}`);
        return;
      }
      const next = shape(await response.json());
      const changed = JSON.stringify(next) !== JSON.stringify(state);
      state = next;
      status = next.current ? 'playing' : 'connected, nothing playing';
      if (changed) announce();
    } catch (error) {
      setStatus(`Spotify unreachable: ${error.message}`);
    }
  }

  function start() {
    stop();
    if (!isConnected()) return;
    poll();
    timer = setInterval(poll, Math.max(1, pollSeconds) * 1000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = 0;
  }

  if (isConnected()) {
    status = 'connected';
    start();
  }

  return {
    connect,
    disconnect,
    completeSignIn,
    start,
    stop,
    subscribe(cb) {
      listeners.add(cb);
      cb(state, status);
      return () => listeners.delete(cb);
    },
    isConfigured: () => Boolean(clientId),
    isConnected,
    getState: () => state,
    getStatus: () => status,
  };
}

export default createSpotify;
