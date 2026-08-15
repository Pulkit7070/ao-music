// Party request queue.
//
// No phones, no server: guests type at this screen and the list lives in
// localStorage, so a refresh or a route switch keeps the night going. The store
// is separate from the rendering so the DJ route can read the count too.

const KEY = 'ao.disco.queue.v1';
const MAX_LEN = 60;

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
    add(name, song) {
      const cleanName = String(name || '').trim().slice(0, 40);
      const cleanSong = String(song || '').trim().slice(0, 80);
      if (!cleanName || !cleanSong) return null;
      counter += 1;
      const row = {
        id: `${Date.now().toString(36)}-${counter}`,
        name: cleanName,
        song: cleanSong,
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
  nodes.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const row = store.add(nodes.name.value, nodes.song.value);
    if (!row) {
      nodes.feedback.textContent = 'Both a name and a song, please.';
      nodes.feedback.dataset.tone = 'warn';
      return;
    }
    nodes.feedback.textContent = `Queued "${row.song}" for ${row.name}.`;
    nodes.feedback.dataset.tone = 'ok';
    nodes.song.value = '';
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
    li.querySelector('.queue__by').textContent = `${entry.name} - ${timeLabel(entry.at)}`;
    return li;
  }

  store.subscribe(() => {
    const pending = store.pending();
    const current = pending[0] || null;
    const upNext = pending.slice(1);

    nodes.now.innerHTML = '';
    if (current) {
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
      nodes.now.querySelector('.queue__now-by').textContent = `requested by ${current.name}`;
    } else {
      delete nodes.now.dataset.id;
      nodes.now.innerHTML =
        '<p class="queue__label">Now playing</p><p class="queue__empty">Nothing queued yet. First request goes straight on.</p>';
    }

    nodes.list.innerHTML = '';
    if (!upNext.length) {
      const li = document.createElement('li');
      li.className = 'queue__empty';
      li.textContent = current ? 'Nothing else queued.' : 'Up next is empty.';
      nodes.list.appendChild(li);
    } else {
      upNext.forEach((entry, i) => nodes.list.appendChild(row(entry, i + 1)));
    }

    const playedCount = store.played().length;
    nodes.count.textContent = `${pending.length} waiting, ${playedCount} played`;
    nodes.clear.disabled = playedCount === 0;
  });
}

export default createQueueStore;
