// Party request queue.
//
// No phones, no server: guests type at this screen and the list lives in
// localStorage, so a refresh or a route switch keeps the night going. The store
// is separate from the rendering so the DJ route can read the count too.

const KEY = 'ao.disco.queue.v1';
const MAX_LEN = 60;

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

/** Reactive store over localStorage. */
export function createQueueStore() {
  let rows = safeParse(localStorage.getItem(KEY));
  const listeners = new Set();
  let counter = 0;

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(rows));
    } catch (error) {
      console.warn('[ao-queue] could not persist the queue', error);
    }
    for (const cb of listeners) cb(rows);
  }

  return {
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
      rows = [...rows, row].slice(-MAX_LEN);
      persist();
      return row;
    },
    markPlayed(id) {
      rows = rows.map((row) => (row.id === id ? { ...row, played: true } : row));
      persist();
    },
    remove(id) {
      rows = rows.filter((row) => row.id !== id);
      persist();
    },
    clearPlayed() {
      rows = rows.filter((row) => !row.played);
      persist();
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
    const current = live ? null : pending[0] || null;
    const upNext = live ? pending : pending.slice(1);

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
      nodes.now.innerHTML =
        '<p class="queue__label">Now playing</p><p class="queue__empty">Nothing queued yet. First request goes straight on.</p>';
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
    /** Tell the card what the booth is playing, or null when it is not. */
    setLive(track) {
      live = track || null;
      render();
    },
  };
}

export default createQueueStore;
