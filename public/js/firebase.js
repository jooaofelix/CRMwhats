/**
 * Inicializacao do Firebase (SDK modular v10, carregado por CDN).
 * Reexporta apenas o que a aplicacao usa, para manter os imports curtos.
 */

import { firebaseConfig } from './config.js';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut,
  updateProfile, sendPasswordResetEmail, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp,
  writeBatch, increment, arrayUnion, arrayRemove, collectionGroup
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
auth.languageCode = 'pt-BR';

/**
 * Cache local persistente: reduz leituras no Firestore (o app relê do disco
 * antes de ir na rede) e mantém a interface utilizável em conexões ruins.
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut,
  updateProfile, sendPasswordResetEmail, setPersistence, browserLocalPersistence,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp,
  writeBatch, increment, arrayUnion, arrayRemove, collectionGroup
};
