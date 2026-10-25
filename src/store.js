import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const FILE = join(DATA_DIR, 'watches.json');

let watches = null;

async function load() {
  if (watches) return watches;
  try {
    watches = JSON.parse(await readFile(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    watches = [];
  }
  return watches;
}

async function save() {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(watches, null, 2));
  await rename(tmp, FILE);
}

export async function listWatches() {
  return load();
}

export async function getWatch(id) {
  return (await load()).find((w) => w.id === id);
}

export async function addWatch(fields) {
  await load();
  const watch = { id: randomUUID(), createdAt: new Date().toISOString(), lastCheck: null, notifiedFor: null, ...fields };
  watches.unshift(watch);
  await save();
  return watch;
}

export async function updateWatch(id, patch) {
  await load();
  const watch = watches.find((w) => w.id === id);
  if (!watch) return null;
  Object.assign(watch, patch);
  await save();
  return watch;
}

export async function deleteWatch(id) {
  await load();
  const before = watches.length;
  watches = watches.filter((w) => w.id !== id);
  if (watches.length !== before) await save();
  return watches.length !== before;
}
