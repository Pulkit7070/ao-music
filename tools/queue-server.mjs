// Shared request queue, so a phone that scans the QR code lands on the same
// list the booth is looking at.
//
// The page keeps its queue in localStorage, which is per browser: fine for one
// screen taking requests typed at it, useless the moment guests use their own
// phones. This is the smallest thing that fixes that: one file, no
// dependencies, run it on the machine in the booth.
//
//   node tools/queue-server.mjs [--port 7475] [--file ~/.ao-disco-queue.json]
//
//   GET    /api/queue            every row
//   POST   /api/queue            { name, song, link } -> the row that was added
//   POST   /api/queue/:id/played mark it played
//   DELETE /api/queue/:id        remove it
//   POST   /api/queue/clear      drop everything already played
//   GET    /api/health           { ok, rows }
//
// Anyone who can reach it can add and remove rows. That is the point at a
// party, and the reason not to leave it running afterwards.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 || !args[i + 1] ? fallback : args[i + 1];
};

const PORT = Number(argValue('--port', 7475));
const FILE = argValue('--file', join(homedir(), '.ao-disco-queue.json'));
const MAX_ROWS = 200;

let rows = [];
try {
  if (existsSync(FILE)) rows = JSON.parse(readFileSync(FILE, 'utf8'));
  if (!Array.isArray(rows)) rows = [];
} catch (error) {
  console.error(`[queue] could not read ${FILE}, starting empty:`, error.message);
  rows = [];
}

function save() {
  try {
    writeFileSync(FILE, JSON.stringify(rows, null, 2));
  } catch (error) {
    console.error('[queue] could not save:', error.message);
  }
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

function readBody(request) {
  return new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
      if (data.length > 8000) request.destroy();
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

let counter = 0;

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const send = (code, body) => {
    response.writeHead(code, {
      'Content-Type': 'application/json',
      // A party is a room full of strangers' phones: any origin may ask.
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
  };

  if (request.method === 'OPTIONS') return send(204, {});

  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/api/health') return send(200, { ok: true, rows: rows.length });
  if (path === '/api/queue' && request.method === 'GET') return send(200, { rows });

  if (path === '/api/queue' && request.method === 'POST') {
    const body = await readBody(request);
    const name = String(body.name || '').trim().slice(0, 40);
    const song = String(body.song || '').trim().slice(0, 80);
    if (!name || !song) return send(400, { error: 'name and song are both required' });
    counter += 1;
    const row = {
      id: `${Date.now().toString(36)}-${counter}`,
      name,
      song,
      link: safeLink(body.link),
      at: Date.now(),
      played: false,
    };
    rows = [...rows, row].slice(-MAX_ROWS);
    save();
    console.log(`[queue] + ${song} (${name})`);
    return send(200, { row, rows });
  }

  if (path === '/api/queue/clear' && request.method === 'POST') {
    rows = rows.filter((row) => !row.played);
    save();
    return send(200, { rows });
  }

  const played = path.match(/^\/api\/queue\/([^/]+)\/played$/);
  if (played && request.method === 'POST') {
    rows = rows.map((row) => (row.id === played[1] ? { ...row, played: true } : row));
    save();
    return send(200, { rows });
  }

  const remove = path.match(/^\/api\/queue\/([^/]+)$/);
  if (remove && request.method === 'DELETE') {
    rows = rows.filter((row) => row.id !== remove[1]);
    save();
    return send(200, { rows });
  }

  send(404, { error: 'no such endpoint' });
});

server.listen(PORT, () => {
  console.log(`[queue] listening on http://0.0.0.0:${PORT}`);
  console.log(`[queue] storing ${rows.length} rows in ${FILE}`);
});
