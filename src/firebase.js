// src/firebase.js — Create React App: use REACT_APP_* (set in Vercel → Environment Variables)
import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

/** Values used only when REACT_APP_* are unset (e.g. local dev without .env). */
const localFallback = {
  apiKey: "AIzaSyAK7otf-wQ6kjjqMRrZYE3Smsqd-ajZ4sc",
  authDomain: "login-7758a.firebaseapp.com",
  databaseURL: "https://login-7758a-default-rtdb.firebaseio.com",
  projectId: "login-7758a",
  storageBucket: "login-7758a.firebasestorage.app",
  messagingSenderId: "617725845152",
  appId: "1:617725845152:web:e9942ead617a9a2cc3b3c5",
  measurementId: "G-D4WF4HRSB8",
};

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || localFallback.apiKey,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || localFallback.authDomain,
  databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL || localFallback.databaseURL,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || localFallback.projectId,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || localFallback.storageBucket,
  messagingSenderId:
    process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || localFallback.messagingSenderId,
  appId: process.env.REACT_APP_FIREBASE_APP_ID || localFallback.appId,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID || localFallback.measurementId,
};

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const auth = getAuth(app);
export const storage = getStorage(app);
export default app;
