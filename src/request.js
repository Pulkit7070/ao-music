// The guest page: ask for a song, see what is on, see what is coming.
//
// It shares two modules with the booth page, the queue store and the booth
// feed, and nothing else. No rig, no console, no choreography, no canvas: a
// phone that scanned a code should not be running a mascot to type a song
// title. Both modules already work standalone, so this stays about forty lines.

import { createQueueStore, resolveQueueUrl } from './queue.js';
import { createNowPlaying } from './nowplaying.js';

const $ = (id) => document.getElementById(id);

// ?queue=... comes from the QR code and is remembered per device. Without it
// there is no shared list to write to, and a request would go nowhere but this
// phone's own storage, so say that rather than pretending it worked.
const store = createQueueStore({ remote: resolveQueueUrl(), pollSeconds: 3 });
const nowPlaying = createNowPlaying();

const statusLine = $('status');
function setStatus(text, tone) {
  statusLine.textContent = text;
  statusLine.dataset.tone = tone;
}

if (!store.isShared()) {
  setStatus('This link is missing the queue address, so the booth will not see your request. Ask for the code again.', 'warn');
}

// -- what is playing ----------------------------------------------------------

let live = null;
nowPlaying.subscribe((state) => {
  live = state && state.current;
  render();
});
nowPlaying.start();

// -- the form -----------------------------------------------------------------

$('form').addEventListener('submit', (event) => {
  event.preventDefault();
  const typedLink = $('link').value.trim();
  const row = store.add($('name').value, $('song').value, typedLink);
  if (!row) {
    setStatus('Both a name and a song, please.', 'warn');
    return;
  }
  setStatus(
    typedLink && !row.link
      ? `Asked for "${row.song}". The link was not a web address, so it was left off.`
      : `Asked for "${row.song}". The booth has it.`,
    'ok',
  );
  $('song').value = '';
  $('link').value = '';
  $('song').focus();
});

// -- the list -----------------------------------------------------------------

function render() {
  const pending = store.pending();

  const now = $('now');
  now.textContent = '';
  if (live) {
    now.append('Now playing');
    const what = document.createElement('b');
    what.textContent = live.artist ? `${live.title} - ${live.artist}` : live.title;
    now.appendChild(what);
  } else {
    now.textContent = nowPlaying.isReachable() ? 'Nothing playing right now' : 'AO plays the disco';
  }

  const list = $('list');
  list.textContent = '';
  if (!pending.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing yet. Yours goes straight on.';
    list.appendChild(li);
    return;
  }
  // Names only, no controls: this list belongs to the booth, a guest is only
  // reading it.
  for (const row of pending.slice(0, 12)) {
    const li = document.createElement('li');
    const song = document.createElement('span');
    song.className = 'song';
    song.textContent = row.song;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = row.name;
    li.append(song, who);
    list.appendChild(li);
  }
}

store.subscribe(render);
render();
