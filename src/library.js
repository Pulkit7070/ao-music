// A catalogue the page is allowed to play.
//
// The honest position first: no web page can legally stream every song ever
// recorded. The major-label catalogue is licensed, which is why Spotify guards
// it, why they cut DJ apps off in 2020, and why a new API app is capped at five
// people. Building a page that streamed the real charts would be a piracy site.
//
// Audius is the largest catalogue that can be played here without asking
// anyone's permission: artists upload their own work and publish it openly, the
// API needs no key and no account, and the audio arrives with
// Access-Control-Allow-Origin, which is the part that matters. Without that
// header the browser would play a track but refuse to let the analyser read it,
// and the mascot would be dancing to nothing. Measured before this was written:
// the spectrum comes back populated, so the beat is real.
//
// It is millions of tracks and it is not the Top 40. Guests will find plenty of
// dance music and will not find this week's number one. For that, bring files
// and use the playlist.

const HOST = 'https://api.audius.co';
const APP = 'aodisco';

/** Seconds to m:ss. */
function clock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The API marks gated and takedown-ed uploads; they are offered by search but
 * answer the stream endpoint with an error. */
function raw_streamable(track, raw) {
  if (!raw) return true;
  if (raw.is_streamable === false) return false;
  return !raw.is_delete && !raw.is_unlisted;
}

function shape(raw) {
  if (!raw || !raw.id) return null;
  return {
    id: String(raw.id),
    title: String(raw.title || '').trim().slice(0, 120) || 'Untitled',
    artist: String((raw.user && raw.user.name) || '').trim().slice(0, 120),
    duration: Number(raw.duration) || 0,
    length: clock(raw.duration),
    art:
      (raw.artwork && (raw.artwork['150x150'] || raw.artwork['480x480'])) || '',
    url: `${HOST}/v1/tracks/${raw.id}/stream?app_name=${APP}`,
    from: 'Audius',
  };
}

/**
 * Search the catalogue.
 *
 * @param {string} query what the DJ typed
 * @param {{ limit?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function search(query, opts = {}) {
  const text = String(query || '').trim();
  if (!text) return [];
  const params = new URLSearchParams({
    query: text,
    limit: String(opts.limit || 12),
    offset: String(opts.offset || 0),
    app_name: APP,
  });
  const response = await fetch(`${HOST}/v1/tracks/search?${params}`, {
    signal: opts.signal,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`search failed: ${response.status}`);
  const body = await response.json();
  const rows = Array.isArray(body.data) ? body.data : [];
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return rows
    .map(shape)
    .filter(Boolean)
    // Songs, not sets. A search for "disco funk" otherwise returns nothing but
    // hour-long DJ mixes, which are useless when a guest asked for one track and
    // the queue is meant to move.
    .filter((track) => track.duration >= 30 && track.duration <= 900)
    .filter((track) => raw_streamable(track, byId.get(track.id)));
}

/**
 * What is popular right now. Used to keep the music going once a playlist runs
 * out: at a party, silence at the end of the last queued track is the failure,
 * not a state to sit in.
 *
 * @param {{ limit?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function trending(opts = {}) {
  const params = new URLSearchParams({
    limit: String(opts.limit || 20),
    app_name: APP,
  });
  const response = await fetch(`${HOST}/v1/tracks/trending?${params}`, {
    signal: opts.signal,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`trending failed: ${response.status}`);
  const body = await response.json();
  const rows = Array.isArray(body.data) ? body.data : [];
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return rows
    .map(shape)
    .filter(Boolean)
    .filter((track) => track.duration >= 30 && track.duration <= 900)
    .filter((track) => raw_streamable(track, byId.get(track.id)));
}

export default { search, trending };
