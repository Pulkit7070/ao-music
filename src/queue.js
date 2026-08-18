// Party request queue.
//
// No phones, no server: guests type at this screen and the list lives in
// localStorage, so a refresh or a route switch keeps the night going. The store
// is separate from the rendering so the DJ route can read the count too.

const KEY = 'ao.disco.queue.v1';
const REMOTE_KEY = 'ao.disco.queue.url';
const MAX_LEN = 60;

// The shared queue server the printed QR code points at. Baked in so that a
// bare /request.html still reaches the booth: a guest who typed the address
// instead of scanning gets the same list as everyone else. Cloudflare quick
// tunnels hand out a new address each time cloudflared restarts, so this is the
// one line to change when that happens.
export const DEFAULT_QUEUE_SERVER = 'https://vsnet-gba-movers-entity.trycloudflare.com';

/**
 * Where the shared queue lives, if there is one. Without it the queue is this
 * browser's localStorage, which is per device: fine for one screen being typed
 * at, useless for a room of phones scanning a QR code. Set with ?queue=... in
 * the address, and remembered after that.
 */
export function resolveQueueUrl(fallback = DEFAULT_QUEUE_SERVER) {
  try {
    const fromQuery = new URLSearchParams(location.search).get('queue');
    if (fromQuery !== null) {
      const cleaned = fromQuery.trim().replace(/\/+$/, '');
      localStorage.setItem(REMOTE_KEY, cleaned);
      return cleaned;
    }
    const saved = localStorage.getItem(REMOTE_KEY);
    if (saved !== null) return saved;
  } catch {
    // storage unavailable; the fallback stands
  }
  return fallback;
}

/**
 * Only http and https survive. A guest types this box, so anything else,
 * javascript: in particular, must never reach an href.
 */
export function safeLink(value) {
  const text = String(value || '').trim().slice(0, 400);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function safeParse(raw) {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((row) => row && typeof row.name === 'string' && typeof row.song === 'string')
      .map((row) => ({
        id: String(row.id || `${row.at || 0}-${Math.random().toString(36).slice(2, 8)}`),
        name: String(row.name).slice(0, 40),
        song: String(row.song).slice(0, 80),
        link: safeLink(row.link),
        at: Number(row.at) || 0,
        played: Boolean(row.played),
      }));
  } catch (error) {
    console.warn('[ao-queue] stored queue was unreadable, starting empty', error);
    return [];
  }
}

/**
 * Reactive store over localStorage, or over the shared queue server when one is
 * configured. The shape is identical either way, so nothing that reads the
 * queue needs to know which it is talking to.
 *
 * @param {object} [options]
 * @param {string} [options.remote] base address of the queue server
 * @param {number} [options.pollSeconds=2.5] how often to re-read it
 */
export function createQueueStore(options = {}) {
  const remote = String(options.remote || '').replace(/\/+$/, '');
  let rows = remote ? [] : safeParse(localStorage.getItem(KEY));
  const listeners = new Set();
  let counter = 0;
  let reachable = !remote;
  let lastError = '';

  function announce() {
    for (const cb of listeners) cb(rows);
  }

  function persist() {
    if (!remote) {
      try {
        localStorage.setItem(KEY, JSON.stringify(rows));
      } catch (error) {
        console.warn('[ao-queue] could not persist the queue', error);
      }
    }
    announce();
  }

  /** Talk to the queue server, and keep the last good rows if it is down. */
  async function call(path, init) {
    if (!remote) return;
    try {
      const response = await fetch(remote + path, {
        cache: 'no-store',
        ...init,
        headers: init && init.body ? { 'Content-Type': 'application/json' } : undefined,
      });
      if (!response.ok) throw new Error(`server answered ${response.status}`);
      const body = await response.json();
      if (Array.isArray(body.rows)) {
        const next = safeParse(JSON.stringify(body.rows));
        const changed = JSON.stringify(next) !== JSON.stringify(rows);
        rows = next;
        reachable = true;
        lastError = '';
        if (changed) announce();
        else announce();
      }
    } catch (error) {
      reachable = false;
      lastError = error.message;
    }
  }

  if (remote) {
    call('/api/queue');
    setInterval(() => call('/api/queue'), Math.max(1, options.pollSeconds || 2.5) * 1000);
  }

  return {
    /** Is the shared queue in use, and is it answering? */
    isShared: () => Boolean(remote),
    isReachable: () => reachable,
    getError: () => lastError,
    getRemote: () => remote,

    all: () => rows,
    pending: () => rows.filter((row) => !row.played),
    played: () => rows.filter((row) => row.played),
    subscribe(cb) {
      listeners.add(cb);
      cb(rows);
      return () => listeners.delete(cb);
    },
    add(name, song, link) {
      const cleanName = String(name || '').trim().slice(0, 40);
      const cleanSong = String(song || '').trim().slice(0, 80);
      if (!cleanName || !cleanSong) return null;
      counter += 1;
      const row = {
        id: `${Date.now().toString(36)}-${counter}`,
        name: cleanName,
        song: cleanSong,
        link: safeLink(link),
        at: Date.now(),
        played: false,
      };
      if (remote) {
        // Show it immediately, then let the server's answer be the truth.
        rows = [...rows, row].slice(-MAX_LEN);
        announce();
        call('/api/queue', { method: 'POST', body: JSON.stringify({ name: cleanName, song: cleanSong, link: row.link }) });
        return row;
      }
      rows = [...rows, row].slice(-MAX_LEN);
      persist();
      return row;
    },
    markPlayed(id) {
      rows = rows.map((row) => (row.id === id ? { ...row, played: true } : row));
      persist();
      if (remote) call(`/api/queue/${encodeURIComponent(id)}/played`, { method: 'POST' });
    },
    remove(id) {
      rows = rows.filter((row) => row.id !== id);
      persist();
      if (remote) call(`/api/queue/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    clearPlayed() {
      rows = rows.filter((row) => !row.played);
      persist();
      if (remote) call('/api/queue/clear', { method: 'POST' });
    },
  };
}

/** An anchor for a stored link. Built with the DOM, never with innerHTML. */
function linkFor(href) {
  const a = document.createElement('a');
  a.className = 'queue__link';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = 'link';
  return a;
}

function timeLabel(at) {
  if (!at) return '';
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Wire the request form and the queue list to a store.
 *
 * @param {object} store from createQueueStore
 * @param {object} nodes { form, name, song, feedback, now, list, count, clear }
 */
export function mountQueueUI(store, nodes) {
  // What the booth says is on, when it is connected. The queue card has to know
  // about it: two panels both headed "now playing", one reading the decks and
  // one reading the request list, is how you end up wondering which is lying.
  let live = null;
  let onAir = false;

  nodes.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const typedLink = nodes.link ? nodes.link.value.trim() : '';
    const row = store.add(nodes.name.value, nodes.song.value, typedLink);
    if (!row) {
      nodes.feedback.textContent = 'Both a name and a song, please.';
      nodes.feedback.dataset.tone = 'warn';
      return;
    }
    const dropped = typedLink && !row.link;
    nodes.feedback.textContent = dropped
      ? `Queued "${row.song}" for ${row.name}. The link was not a web address, so it was left off.`
      : `Queued "${row.song}" for ${row.name}.`;
    nodes.feedback.dataset.tone = dropped ? 'warn' : 'ok';
    nodes.song.value = '';
    if (nodes.link) nodes.link.value = '';
    nodes.song.focus();
  });

  nodes.clear.addEventListener('click', () => store.clearPlayed());

  // One delegated handler: rows come and go.
  nodes.list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.closest('[data-id]').dataset.id;
    if (button.dataset.action === 'played') store.markPlayed(id);
    if (button.dataset.action === 'remove') store.remove(id);
  });

  nodes.now.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.closest('[data-id]').dataset.id;
    if (button.dataset.action === 'played') store.markPlayed(id);
    if (button.dataset.action === 'remove') store.remove(id);
  });

  function row(entry, index) {
    const li = document.createElement('li');
    li.className = 'queue__row';
    li.dataset.id = entry.id;
    li.innerHTML = `
      <span class="queue__pos">${index}</span>
      <span class="queue__song"></span>
      <span class="queue__by"></span>
      <span class="queue__actions">
        <button type="button" data-action="played">Played</button>
        <button type="button" data-action="remove">Remove</button>
      </span>`;
    li.querySelector('.queue__song').textContent = entry.song;
    const by = li.querySelector('.queue__by');
    by.textContent = `${entry.name} - ${timeLabel(entry.at)}`;
    if (entry.link) by.appendChild(linkFor(entry.link));
    return li;
  }

  function render() {
    const pending = store.pending();
    // With a live track from the booth, nothing in the queue has played yet, so
    // every request is still to come.
    // The monitor is the authority whenever it is answering, so no request is
    // ever shown as playing while it is connected.
    const current = live || onAir ? null : pending[0] || null;
    const upNext = live || onAir ? pending : pending.slice(1);

    nodes.now.innerHTML = '';
    if (live) {
      nodes.now.dataset.live = 'yes';
      delete nodes.now.dataset.id;
      nodes.now.innerHTML = `
        <p class="queue__label">Now playing, from djay</p>
        <p class="queue__now-song"></p>
        <p class="queue__now-by"></p>`;
      nodes.now.querySelector('.queue__now-song').textContent = live.title;
      nodes.now.querySelector('.queue__now-by').textContent = [
        live.artist,
        live.deck ? `deck ${live.deck}` : '',
        live.remaining,
      ].filter(Boolean).join('  ');
    } else if (current) {
      delete nodes.now.dataset.live;
      nodes.now.dataset.id = current.id;
      nodes.now.innerHTML = `
        <p class="queue__label">Now playing</p>
        <p class="queue__now-song"></p>
        <p class="queue__now-by"></p>
        <span class="queue__actions">
          <button type="button" data-action="played">Mark played</button>
          <button type="button" data-action="remove">Remove</button>
        </span>`;
      nodes.now.querySelector('.queue__now-song').textContent = current.song;
      const nowBy = nodes.now.querySelector('.queue__now-by');
      nowBy.textContent = `requested by ${current.name}`;
      if (current.link) nowBy.appendChild(linkFor(current.link));
    } else {
      delete nodes.now.dataset.id;
      delete nodes.now.dataset.live;
      const note = onAir
        ? 'Nothing is playing at the decks.'
        : 'Nothing queued yet. First request goes straight on.';
      nodes.now.innerHTML = `<p class="queue__label">Now playing</p><p class="queue__empty">${note}</p>`;
    }

    nodes.list.innerHTML = '';
    if (!upNext.length) {
      const li = document.createElement('li');
      li.className = 'queue__empty';
      li.textContent = current || live ? 'No requests waiting.' : 'Up next is empty.';
      nodes.list.appendChild(li);
    } else {
      upNext.forEach((entry, i) => nodes.list.appendChild(row(entry, i + 1)));
    }

    const playedCount = store.played().length;
    nodes.count.textContent = `${pending.length} waiting, ${playedCount} played`;
    nodes.clear.disabled = playedCount === 0;
  }

  store.subscribe(render);

  return {
    /**
     * Tell the card what the booth is playing, or null when it is not, and
     * whether the monitor is answering at all.
     */
    setLive(track, monitorAnswering) {
      live = track || null;
      onAir = Boolean(monitorAnswering);
      render();
    },
  };
}

export default createQueueStore;
