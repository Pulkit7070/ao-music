// What the desktop music app is playing, without the Spotify Web API.
//
// The Web API is a dead end for this: since February 2026 a new app is capped
// at five allowlisted users, lifting that needs a registered business with a
// quarter of a million monthly users, and the endpoints that carried tempo were
// closed to new apps in 2024. None of that applies here. The Spotify and Music
// apps on macOS have answered AppleScript for years, and they answer it locally,
// with no account, no quota, no client id, and nothing that a network can block.
//
//   node tools/desktop-music.mjs [--port 7476] [--app Spotify]
//
//   GET /api/status   what is playing, in the shape the page already reads
//   GET /api/health   { ok, app, running }
//   POST /api/refresh same as status, so the page's forced re-read works
//
// It also serves the site itself, and that is not a convenience. An https page
// cannot fetch a plain http address, and loopback is not the exception the
// specification suggests: the deployed site fetching 127.0.0.1 was measured
// failing in Chrome. Serving both from here puts them on one origin, which
// leaves nothing to block, no CORS, and no certificate to arrange.
//
//   node tools/desktop-music.mjs   then open http://127.0.0.1:7476/#dj
//
// This reports the title. It does not carry audio, so the beat still comes from
// the microphone or from Play a track. See docs/DESKTOP_MUSIC.md for routing the
// app's own audio into the page, which is the better answer for the beat.

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 || !args[i + 1] ? fallback : args[i + 1];
};

const PORT = Number(argValue('--port', 7476));
// "Spotify" or "Music". Both expose the same handful of properties.
const APP = argValue('--app', 'Spotify');

/** Seconds to m:ss, which is what the page prints. */
function clock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function osascript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 4000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

/**
 * Ask the app directly. Returns null when it is not running: launching a music
 * player because a web page asked would be its own kind of rude, so the script
 * checks first and never triggers the launch that `tell application` would.
 */
async function readApp() {
  const running = await osascript(
    `tell application "System Events" to (name of processes) contains "${APP}"`,
  ).catch(() => 'false');
  if (running !== 'true') return null;

  // One round trip, tab separated: asking property by property lets the track
  // change underneath and returns a title from one song with the position of
  // the next.
  const raw = await osascript(
    `tell application "${APP}"
      if player state is stopped then return "stopped"
      set t to current track
      return (player state as text) & tab & (name of t) & tab & (artist of t) & tab & ¬
        (album of t) & tab & (player position as text) & tab & (duration of t as text)
    end tell`,
  ).catch(() => '');

  if (!raw || raw === 'stopped') return { running: true, playing: false, track: null };

  const [state, title, artist, album, position, duration] = raw.split('\t');
  // Spotify reports duration in milliseconds, the Music app in seconds. Tell
  // them apart by magnitude: no track is four hours long, and none is 226 ms.
  const rawDuration = Number(duration) || 0;
  const seconds = rawDuration > 10000 ? rawDuration / 1000 : rawDuration;
  const elapsed = Number(position) || 0;

  return {
    running: true,
    playing: state === 'playing',
    track: {
      title: String(title || '').trim(),
      artist: String(artist || '').trim(),
      album: String(album || '').trim(),
      elapsed: clock(elapsed),
      remaining: seconds > 0 ? `-${clock(Math.max(0, seconds - elapsed))}` : '',
    },
  };
}

/** The djay-monitor shape, so the page needs no new adapter. */
function asStatus(reading) {
  if (!reading) return { source: APP, djayRunning: false, status: `${APP} is not running`, current: null };
  if (!reading.track) return { source: APP, djayRunning: true, status: 'stopped', current: null };
  return {
    source: APP,
    djayRunning: true,
    status: reading.playing ? 'playing' : 'paused',
    // A paused track is not what the room is dancing to, so it is not current.
    current: reading.playing ? { ...reading.track, deck: 1 } : null,
    paused: !reading.playing ? reading.track : null,
    updatedAt: new Date().toISOString(),
  };
}

const server = createServer(async (request, response) => {
  const send = (code, body) => {
    response.writeHead(code, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      // Chrome guards requests from a public site into the private network or
      // loopback: the preflight asks, and without this header the fetch fails
      // before it arrives. Saying yes here is the whole consent, which is why
      // this server binds to 127.0.0.1 and nothing else can reach it.
      'Access-Control-Allow-Private-Network': 'true',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
  };

  if (request.method === 'OPTIONS') return send(204, {});
  const rawPath = new URL(request.url, 'http://localhost').pathname;
  const path = rawPath.replace(/\/+$/, '') || '/';

  try {
    if (path === '/api/health') {
      const reading = await readApp();
      return send(200, { ok: true, app: APP, running: Boolean(reading) });
    }
    if (path === '/api/status' || path === '/api/refresh') {
      return send(200, asStatus(await readApp()));
    }
    return await sendFile(rawPath, response);
  } catch (error) {
    return send(500, { error: error.message });
  }
});

// -- the site ------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
};

async function sendFile(rawPath, response) {
  const wanted = rawPath === '/' || rawPath === '' ? '/index.html' : decodeURIComponent(rawPath);
  // normalize collapses any ".." before it is joined, so a request cannot climb
  // out of the project directory and read the rest of the disk.
  const target = join(ROOT, normalize(wanted).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(ROOT)) {
    response.writeHead(403).end('no');
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(target);
    response.writeHead(200, {
      'Content-Type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[music] reading ${APP}`);
  console.log(`[music] open http://127.0.0.1:${PORT}/#dj`);
});
