// The shared request queue, hosted.
//
// It used to live on the DJ's laptop behind a cloudflare quick tunnel, which
// meant the address changed on every reboot and took the printed QR code with
// it. A code on a poster has to outlive a restart, so the queue moved here: same
// origin as the site, nothing to run, nothing to keep awake.
//
//   GET    /api/queue              every row
//   POST   /api/queue              { name, song, link } -> the row that was added
//   POST   /api/queue/:id/played   mark it played
//   DELETE /api/queue/:id          remove it
//   POST   /api/queue/clear        drop everything already played
//
// The path forms above are rewritten to this one function in vercel.json, so
// the client contract is unchanged from the laptop version.
//
// Rows live in a Redis hash keyed by id rather than as one JSON blob. Two guests
// pressing send at the same moment would otherwise read the same list, each add
// their own row, and the second write would erase the first. A field-level write
// cannot lose anyone's request.
//
// CommonJS and no dependencies on purpose: this project has no package.json and
// no build step, and Upstash speaks plain HTTP.

const KEY = 'aodisco:rows';
const MAX_ROWS = 300;

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

/** One Upstash REST command, e.g. redis('HSET', KEY, id, json). */
async function redis(...command) {
  const response = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) throw new Error(body.error || `redis ${response.status}`);
  return body.result;
}

/** Only http and https survive: a guest types this box. */
function safeLink(value) {
  const text = String(value || '').trim().slice(0, 400);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

async function readRows() {
  const flat = await redis('HGETALL', KEY);
  if (!Array.isArray(flat)) return [];
  const rows = [];
  for (let i = 0; i < flat.length; i += 2) {
    try {
      rows.push(JSON.parse(flat[i + 1]));
    } catch {
      // A row that will not parse is not worth failing the whole list over.
    }
  }
  return rows.sort((a, b) => (a.at || 0) - (b.at || 0));
}

module.exports = async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'OPTIONS') return response.status(204).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return response.status(503).json({ error: 'queue store is not configured' });
  }

  // Set by the rewrites in vercel.json, so the tidy paths above still work.
  const { action = '', id = '' } = request.query || {};

  try {
    if (request.method === 'GET') {
      return response.status(200).json({ rows: await readRows() });
    }

    if (request.method === 'POST' && action === 'clear') {
      const rows = await readRows();
      const played = rows.filter((row) => row.played).map((row) => row.id);
      if (played.length) await redis('HDEL', KEY, ...played);
      return response.status(200).json({ rows: rows.filter((row) => !row.played) });
    }

    if (request.method === 'POST' && action === 'played') {
      const raw = await redis('HGET', KEY, String(id));
      if (!raw) return response.status(404).json({ error: 'no such row' });
      const row = { ...JSON.parse(raw), played: true };
      await redis('HSET', KEY, row.id, JSON.stringify(row));
      return response.status(200).json({ rows: await readRows() });
    }

    if (request.method === 'DELETE') {
      await redis('HDEL', KEY, String(id));
      return response.status(200).json({ rows: await readRows() });
    }

    if (request.method === 'POST') {
      const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      const name = String(body.name || '').trim().slice(0, 40);
      const song = String(body.song || '').trim().slice(0, 80);
      if (!name || !song) {
        return response.status(400).json({ error: 'name and song are both required' });
      }
      const at = Date.now();
      const row = {
        // Time first so the id sorts the way the list does, and a random tail so
        // two guests in the same millisecond cannot collide on one field.
        id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        song,
        link: safeLink(body.link),
        at,
        played: false,
      };
      await redis('HSET', KEY, row.id, JSON.stringify(row));

      // A night that runs long should not grow without limit.
      const rows = await readRows();
      if (rows.length > MAX_ROWS) {
        await redis('HDEL', KEY, ...rows.slice(0, rows.length - MAX_ROWS).map((r) => r.id));
      }
      return response.status(200).json({ row, rows: await readRows() });
    }

    return response.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
};
