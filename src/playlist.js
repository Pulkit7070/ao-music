// The deck: what is playing, and what plays next.
//
// Two kinds of track sit in the same list and nothing downstream needs to tell
// them apart. A local file is a Blob turned into an object URL; a catalogue
// track is a remote URL that arrives with permissive CORS. Both reach the
// analyser the same way, so both give a real beat.
//
// The list is deliberately not persisted. Object URLs die with the page and a
// remembered playlist of dead links is worse than an empty one.

let counter = 0;

function id() {
  counter += 1;
  return `t${counter}`;
}

/** A filename is a poor title but an honest one. */
function titleFromFile(name) {
  return (
    String(name || '')
      .replace(/\.[^.]+$/, '')
      .replace(/^\d+[\s._-]+/, '')
      .trim() || String(name || 'Untitled')
  );
}

/**
 * @returns {{
 *   add(tracks: object[]): object[], addFiles(files: FileList|File[]): object[],
 *   remove(id: string): void, clear(): void, tracks(): object[],
 *   current(): object|null, playAt(index: number): object|null,
 *   next(): object|null, previous(): object|null, isEmpty(): boolean,
 *   subscribe(cb: () => void): () => void
 * }}
 */
export function createPlaylist() {
  let tracks = [];
  let index = -1;
  let shuffle = false;
  const listeners = new Set();

  const announce = () => listeners.forEach((cb) => cb());

  function at(i) {
    return i >= 0 && i < tracks.length ? tracks[i] : null;
  }

  return {
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    add(incoming) {
      const rows = (Array.isArray(incoming) ? incoming : [incoming])
        .filter(Boolean)
        .map((track) => ({ ...track, id: track.id || id() }));
      tracks = [...tracks, ...rows];
      announce();
      return rows;
    },

    addFiles(files) {
      const rows = Array.from(files || [])
        .filter((file) => file && file.type.startsWith('audio/'))
        .map((file) => ({
          id: id(),
          title: titleFromFile(file.name),
          artist: '',
          length: '',
          // Held for the life of the page. Revoked in remove/clear, because a
          // long night of adding and dropping files would otherwise keep every
          // one of them in memory.
          url: URL.createObjectURL(file),
          local: true,
          from: 'this device',
        }));
      if (rows.length) {
        tracks = [...tracks, ...rows];
        announce();
      }
      return rows;
    },

    remove(rowId) {
      const i = tracks.findIndex((t) => t.id === rowId);
      if (i === -1) return;
      if (tracks[i].local) URL.revokeObjectURL(tracks[i].url);
      tracks = tracks.filter((t) => t.id !== rowId);
      // Keep pointing at the same track when something above it is dropped.
      if (i < index) index -= 1;
      else if (i === index) index = Math.min(index, tracks.length - 1);
      announce();
    },

    clear() {
      tracks.forEach((t) => t.local && URL.revokeObjectURL(t.url));
      tracks = [];
      index = -1;
      announce();
    },

    tracks: () => tracks,
    isEmpty: () => tracks.length === 0,
    current: () => at(index),

    playAt(i) {
      if (i < 0 || i >= tracks.length) return null;
      index = i;
      announce();
      return tracks[index];
    },

    setShuffle(on) {
      shuffle = Boolean(on);
      announce();
    },

    isShuffled: () => shuffle,

    next() {
      if (tracks.length === 0) return null;
      if (shuffle && tracks.length > 1) {
        // Anything but the one just played, so shuffle never repeats a track
        // back to back, which reads as the button being broken.
        const choices = tracks.map((_, i) => i).filter((i) => i !== index);
        index = choices[Math.floor(Math.random() * choices.length)];
        announce();
        return tracks[index];
      }
      if (index + 1 >= tracks.length) return null;
      index += 1;
      announce();
      return tracks[index];
    },

    previous() {
      if (index - 1 < 0) return null;
      index -= 1;
      announce();
      return tracks[index];
    },
  };
}

export default createPlaylist;
