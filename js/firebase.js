// ─────────────────────────────────────────────────────────
//  firebase.js  —  config + Firestore helpers
//  ⚠️  RELLENA firebaseConfig con tus datos de Firebase Console
// ─────────────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDfdfQeNfzolW-IDkAZIimub0Uer5NUD_s",
  authDomain:        "wimc-project-d9e2f.firebaseapp.com",
  projectId:         "wimc-project-d9e2f",
  storageBucket:     "wimc-project-d9e2f.firebasestorage.app",
  messagingSenderId: "538911229149",
  appId:             "1:538911229149:web:ee3524bc71ab49d6844734",
};
// ─────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// ─── AUTH ─────────────────────────────────────────────────

export function registerUser(email, password, name) {
  return createUserWithEmailAndPassword(auth, email, password).then((cred) => {
    if (name) return updateProfile(cred.user, { displayName: name }).then(() => cred.user);
    return cred.user;
  });
}

export function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logoutUser() {
  return signOut(auth);
}

export function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// ─── CARS ─────────────────────────────────────────────────

function carsRef(uid) {
  return collection(db, "users", uid, "cars");
}

function carDocRef(uid, carId) {
  return doc(db, "users", uid, "cars", carId);
}

export async function getCars(uid) {
  const snap = await getDocs(carsRef(uid));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function listenCars(uid, callback) {
  return onSnapshot(carsRef(uid), (snap) => {
    const cars = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(cars);
  });
}

export async function addCar(uid, name, color) {
  const ref = doc(carsRef(uid)); // auto-id
  await setDoc(ref, { name, color, parking: null, createdAt: Date.now() });
  return ref.id;
}

export async function updateCar(uid, carId, data) {
  await updateDoc(carDocRef(uid, carId), data);
}

export async function deleteCar(uid, carId) {
  await deleteDoc(carDocRef(uid, carId));
}

// ─── PARKING ──────────────────────────────────────────────

export async function saveParking(uid, carId, lat, lng, address, reference) {
  await updateDoc(carDocRef(uid, carId), {
    parking: { lat, lng, address, reference, savedAt: Date.now() },
  });
}

export async function deleteParking(uid, carId) {
  await updateDoc(carDocRef(uid, carId), { parking: null });
}

// ─── REVERSE GEOCODING (Nominatim, gratis) ────────────────

export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res  = await fetch(url, { headers: { "Accept-Language": "es" } });
    const data = await res.json();
    return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}