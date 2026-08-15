/** Firebase Auth simulado, com sessão persistida em localStorage. */

const USERS_KEY = '__mock_users__';
const SESSION_KEY = '__mock_session__';

const readUsers = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); } catch { return {}; } };
const writeUsers = (u) => localStorage.setItem(USERS_KEY, JSON.stringify(u));

let listeners = [];
let auth = null;

function makeUser(record) {
  return {
    uid: record.uid,
    email: record.email,
    displayName: record.displayName || null,
    photoURL: record.photoURL || null,
    getIdToken: async () => `mock-token-${record.uid}`
  };
}

function setCurrent(user) {
  auth.currentUser = user;
  if (user) localStorage.setItem(SESSION_KEY, user.uid);
  else localStorage.removeItem(SESSION_KEY);
  listeners.forEach((cb) => cb(user));
}

export function getAuth() {
  if (auth) return auth;
  auth = { currentUser: null, languageCode: 'pt-BR' };
  const uid = localStorage.getItem(SESSION_KEY);
  if (uid) {
    const record = readUsers()[uid];
    if (record) auth.currentUser = makeUser(record);
  }
  return auth;
}

export function onAuthStateChanged(a, cb) {
  listeners.push(cb);
  setTimeout(() => cb(a.currentUser), 0);
  return () => { listeners = listeners.filter((l) => l !== cb); };
}

export async function createUserWithEmailAndPassword(a, email, password) {
  const users = readUsers();
  if (Object.values(users).some((u) => u.email === email)) {
    const err = new Error('email already in use'); err.code = 'auth/email-already-in-use'; throw err;
  }
  const uid = `uid_${Math.random().toString(36).slice(2, 10)}`;
  users[uid] = { uid, email, password, displayName: null, photoURL: null };
  writeUsers(users);
  const user = makeUser(users[uid]);
  setCurrent(user);
  return { user };
}

export async function signInWithEmailAndPassword(a, email, password) {
  const users = readUsers();
  const record = Object.values(users).find((u) => u.email === email && u.password === password);
  if (!record) { const err = new Error('invalid'); err.code = 'auth/invalid-credential'; throw err; }
  const user = makeUser(record);
  setCurrent(user);
  return { user };
}

export async function updateProfile(user, patch) {
  const users = readUsers();
  Object.assign(users[user.uid], patch);
  writeUsers(users);
  Object.assign(user, patch);
  if (auth.currentUser?.uid === user.uid) Object.assign(auth.currentUser, patch);
}

export async function signOut() { setCurrent(null); }
export async function setPersistence() {}
export const browserLocalPersistence = 'local';
export async function sendPasswordResetEmail() {}
export class GoogleAuthProvider { setCustomParameters() {} }
export async function signInWithPopup() { const err = new Error('popup'); err.code = 'auth/popup-blocked'; throw err; }
export async function signInWithRedirect() {}
export async function getRedirectResult() { return null; }
