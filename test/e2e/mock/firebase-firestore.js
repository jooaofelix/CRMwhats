/**
 * Firestore em memória para testes de UI (substitui o SDK real).
 * Persiste em localStorage para sobreviver a reloads.
 */

const KEY = '__mock_firestore__';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function save() { localStorage.setItem(KEY, JSON.stringify(store)); }

let store = load();
const watchers = new Set();
function notify() { save(); [...watchers].forEach((w) => { try { w(); } catch (e) { console.error(e); } }); }

export class Timestamp {
  constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; this.__ts = true; }
  toDate() { return new Date(this.seconds * 1000); }
  toMillis() { return this.seconds * 1000; }
  static now() { return new Timestamp(Math.floor(Date.now() / 1000)); }
  static fromDate(d) { return new Timestamp(Math.floor(new Date(d).getTime() / 1000)); }
}

function revive(value) {
  if (value && typeof value === 'object' && value.__ts) return new Timestamp(value.seconds, value.nanoseconds);
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = revive(v);
    return out;
  }
  return value;
}
function serialize(value) {
  if (value instanceof Timestamp) return { __ts: true, seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof Date) return { __ts: true, seconds: Math.floor(value.getTime() / 1000), nanoseconds: 0 };
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

let idCounter = 0;
function autoId() { return `id${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

export function initializeApp() { return { name: 'mock' }; }
export function initializeFirestore() { return { type: 'mock-db' }; }
export function persistentLocalCache() { return {}; }
export function persistentMultipleTabManager() { return {}; }
export function getFirestore() { return { type: 'mock-db' }; }

class DocRef {
  constructor(path) { this.path = path; this.id = path.split('/').pop(); this.__doc = true; }
}
class ColRef {
  constructor(path) { this.path = path; this.id = path.split('/').pop(); this.__col = true; }
}

export function collection(dbOrRef, ...segments) {
  const base = dbOrRef?.path ? `${dbOrRef.path}/` : '';
  return new ColRef(base + segments.join('/'));
}
export function doc(dbOrRef, ...segments) {
  if (dbOrRef instanceof ColRef && segments.length === 0) return new DocRef(`${dbOrRef.path}/${autoId()}`);
  const base = dbOrRef?.path ? `${dbOrRef.path}/` : '';
  return new DocRef(base + segments.join('/'));
}
export function collectionGroup(db, name) { return new ColRef(`__group__/${name}`); }

export function serverTimestamp() { return Timestamp.now(); }
export function increment(n) { return { __inc: n }; }
export function arrayUnion(...v) { return { __union: v }; }
export function arrayRemove(...v) { return { __remove: v }; }

function applyOps(existing, patch) {
  const out = { ...(existing || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && v.__inc !== undefined) out[k] = (Number(out[k]) || 0) + v.__inc;
    else if (v && typeof v === 'object' && v.__union) out[k] = [...new Set([...(out[k] || []), ...v.__union])];
    else if (v && typeof v === 'object' && v.__remove) out[k] = (out[k] || []).filter((x) => !v.__remove.includes(x));
    else out[k] = v;
  }
  return out;
}

function snapshotFor(path) {
  const raw = store[path];
  return {
    id: path.split('/').pop(),
    ref: new DocRef(path),
    exists: () => raw !== undefined,
    data: () => (raw === undefined ? undefined : revive(raw))
  };
}

export async function getDoc(ref) { return snapshotFor(ref.path); }

export async function setDoc(ref, data, options = {}) {
  const payload = serialize(data);
  store[ref.path] = options.merge ? deepMerge(store[ref.path] || {}, payload) : payload;
  notify();
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && !v.__ts && a[k] && typeof a[k] === 'object' && !a[k].__ts)
      ? deepMerge(a[k], v) : v;
  }
  return out;
}

export async function addDoc(colRef, data) {
  const ref = new DocRef(`${colRef.path}/${autoId()}`);
  store[ref.path] = serialize(data);
  notify();
  return ref;
}

export async function updateDoc(ref, data) {
  if (store[ref.path] === undefined) {
    const err = new Error('No document to update'); err.code = 'not-found'; throw err;
  }
  store[ref.path] = applyOps(store[ref.path], serialize(data));
  notify();
}

export async function deleteDoc(ref) { delete store[ref.path]; notify(); }

export function where(field, op, value) { return { type: 'where', field, op, value }; }
export function orderBy(field, dir = 'asc') { return { type: 'orderBy', field, dir }; }
export function limit(n) { return { type: 'limit', n }; }

export function query(colRef, ...constraints) {
  return { __query: true, path: colRef.path, constraints };
}

function fieldValue(data, field) {
  return field.split('.').reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), data);
}
function comparable(value) {
  if (value === undefined || value === null) return null;
  if (value && value.__ts) return value.seconds;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function runQuery(q) {
  const path = q.path;
  const depth = path.split('/').length;
  let docs = Object.keys(store)
    .filter((p) => p.startsWith(`${path}/`) && p.split('/').length === depth + 1)
    .map((p) => ({ path: p, data: store[p] }));

  const constraints = q.constraints || [];
  for (const c of constraints) {
    if (c.type !== 'where') continue;
    docs = docs.filter(({ data }) => {
      const v = comparable(fieldValue(data, c.field));
      const target = comparable(serialize(c.value));
      switch (c.op) {
        case '==': return v === target;
        case '!=': return v !== target;
        case '>': return v > target;
        case '>=': return v >= target;
        case '<': return v < target;
        case '<=': return v <= target;
        case 'in': return c.value.includes(fieldValue(data, c.field));
        case 'array-contains': return (fieldValue(data, c.field) || []).includes(c.value);
        default: return true;
      }
    });
  }

  const orders = constraints.filter((c) => c.type === 'orderBy');
  for (const o of orders) {
    // Firestore real exclui documentos sem o campo do orderBy — replicado aqui.
    docs = docs.filter(({ data }) => fieldValue(data, o.field) !== undefined && fieldValue(data, o.field) !== null);
  }
  for (const o of [...orders].reverse()) {
    docs.sort((a, b) => {
      const av = comparable(fieldValue(a.data, o.field));
      const bv = comparable(fieldValue(b.data, o.field));
      if (av === bv) return 0;
      const result = av > bv ? 1 : -1;
      return o.dir === 'desc' ? -result : result;
    });
  }

  const lim = constraints.find((c) => c.type === 'limit');
  if (lim) docs = docs.slice(0, lim.n);

  return docs.map(({ path: p }) => snapshotFor(p));
}

export async function getDocs(q) {
  const docs = q.__query ? runQuery(q) : runQuery({ path: q.path, constraints: [] });
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
}

export function onSnapshot(target, onNext, onError) {
  const emit = () => {
    try {
      if (target.__doc) { onNext(snapshotFor(target.path)); return; }
      const docs = target.__query ? runQuery(target) : runQuery({ path: target.path, constraints: [] });
      onNext({ docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) });
    } catch (err) { onError?.(err); }
  };
  watchers.add(emit);
  setTimeout(emit, 0);
  return () => watchers.delete(emit);
}

export function writeBatch() {
  const ops = [];
  return {
    set(ref, data, options) { ops.push(() => { store[ref.path] = options?.merge ? deepMerge(store[ref.path] || {}, serialize(data)) : serialize(data); }); return this; },
    update(ref, data) { ops.push(() => { store[ref.path] = applyOps(store[ref.path], serialize(data)); }); return this; },
    delete(ref) { ops.push(() => { delete store[ref.path]; }); return this; },
    async commit() { ops.forEach((op) => op()); notify(); }
  };
}

// Utilitário exposto para o teste inspecionar o banco.
window.__mockStore = () => store;
window.__mockReset = () => { store = {}; localStorage.removeItem(KEY); notify(); };
