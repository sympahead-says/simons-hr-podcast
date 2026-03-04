const DB_NAME = "rp-podcast";
const DB_VERSION = 1;
const STORE = "episodes";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveEpisode(episode) {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  // Store raw blobs alongside segments
  const toStore = {
    ...episode,
    segments: await Promise.all(
      episode.segments.map(async (seg) => {
        const resp = await fetch(seg.url);
        const blob = await resp.blob();
        return { speaker: seg.speaker, text: seg.text, blob };
      })
    ),
  };
  tx.objectStore(STORE).put(toStore);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadEpisodes() {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const episodes = req.result
        .map((ep) => ({
          ...ep,
          segments: ep.segments.map((seg) => ({
            ...seg,
            url: URL.createObjectURL(seg.blob),
          })),
        }))
        .sort((a, b) => b.id - a.id);
      resolve(episodes);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteEpisode(id) {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
