import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebase";
import { generateSecureToken, vendorPortalUrl } from "./tokenUtils";
import { STORE_STATUS } from "../../marketplace/constants";
import { fileToProductImageBase64 } from "../../utils/productImage";

const STORES = "stores";
const VENDOR_TOKENS = "vendorTokens";

export function storesCollection() {
  return collection(db, STORES);
}

export function storeDocRef(storeId) {
  return doc(db, STORES, storeId);
}

export function storeProductsCollection(storeId) {
  return collection(db, STORES, storeId, "products");
}

export function vendorOrdersCollection(storeId) {
  return collection(db, STORES, storeId, "vendorOrders");
}

function mapStoreDocs(snap, activeOnly) {
  let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (activeOnly) {
    list = list.filter((s) => s.status === STORE_STATUS.ACTIVE);
  }
  list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return list;
}

/** Single-field index on `name` only — filter active stores client-side to avoid composite indexes. */
export async function listStores({ activeOnly = false } = {}) {
  const snap = await getDocs(query(storesCollection(), orderBy("name")));
  return mapStoreDocs(snap, activeOnly);
}

export function subscribeStores(callback, { activeOnly = false } = {}) {
  const q = query(storesCollection(), orderBy("name"));
  return onSnapshot(
    q,
    (snap) => callback(mapStoreDocs(snap, activeOnly)),
    (err) => {
      console.error("subscribeStores", err);
      callback([]);
    }
  );
}

export async function getStore(storeId) {
  const snap = await getDoc(storeDocRef(storeId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function validateVendorToken(storeId, token) {
  if (!storeId || !token) return { ok: false, error: "Missing credentials" };
  const store = await getStore(storeId);
  if (!store || store.status !== STORE_STATUS.ACTIVE) {
    return { ok: false, error: "Store not found or inactive" };
  }
  if (!store.vendorTokenId) return { ok: false, error: "Invalid token configuration" };

  const tokenSnap = await getDoc(doc(db, VENDOR_TOKENS, store.vendorTokenId));
  if (!tokenSnap.exists()) return { ok: false, error: "Invalid token" };

  const data = tokenSnap.data();
  if (data.storeId !== storeId || data.token !== token || data.active === false) {
    return { ok: false, error: "Access denied" };
  }
  return { ok: true, store };
}

/** Store logo as base64 data URL in Firestore (avoids Storage CORS in local dev). */
export async function uploadStoreLogo(_storeId, file) {
  return fileToProductImageBase64(file);
}

/**
 * Create store + vendor token. Returns store with portalUrl.
 */
export async function createStore(payload) {
  const storeRef = doc(storesCollection());
  const token = generateSecureToken();
  const tokenRef = doc(collection(db, VENDOR_TOKENS));

  const storeData = {
    storeId: storeRef.id,
    name: String(payload.name || "").trim(),
    ownerName: String(payload.ownerName || "").trim(),
    contactNumber: String(payload.contactNumber || "").trim(),
    stallNumber: String(payload.stallNumber || "").trim(),
    category: payload.category || "food",
    commissionRate: Number(payload.commissionRate) || 0,
    logoUrl: payload.logoUrl || null,
    status: payload.status || STORE_STATUS.ACTIVE,
    vendorTokenId: tokenRef.id,
    portalPath: `/vendor/store/${storeRef.id}`,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(tokenRef, {
    storeId: storeRef.id,
    token,
    active: true,
    createdAt: serverTimestamp(),
  });

  await setDoc(storeRef, storeData);

  const portalUrl = vendorPortalUrl(storeRef.id, token);
  await updateDoc(storeRef, { portalUrl, updatedAt: serverTimestamp() });

  return {
    id: storeRef.id,
    ...storeData,
    token,
    portalUrl,
  };
}

export async function updateStore(storeId, patch) {
  await updateDoc(storeDocRef(storeId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteStore(storeId) {
  const store = await getStore(storeId);
  if (store?.vendorTokenId) {
    await deleteDoc(doc(db, VENDOR_TOKENS, store.vendorTokenId));
  }
  await deleteDoc(storeDocRef(storeId));
}

export async function rotateVendorToken(storeId) {
  const store = await getStore(storeId);
  if (!store) throw new Error("Store not found");

  const token = generateSecureToken();
  if (store.vendorTokenId) {
    await updateDoc(doc(db, VENDOR_TOKENS, store.vendorTokenId), {
      token,
      active: true,
      rotatedAt: serverTimestamp(),
    });
  } else {
    const tokenRef = doc(collection(db, VENDOR_TOKENS));
    await setDoc(tokenRef, { storeId, token, active: true, createdAt: serverTimestamp() });
    await updateDoc(storeDocRef(storeId), { vendorTokenId: tokenRef.id });
  }

  const portalUrl = vendorPortalUrl(storeId, token);
  await updateDoc(storeDocRef(storeId), { portalUrl, updatedAt: serverTimestamp() });
  return { token, portalUrl };
}
