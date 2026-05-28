import {
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  increment,
  serverTimestamp,
} from "firebase/firestore";
import { storeProductsCollection } from "./storesService";
import { fileToProductImageBase64 } from "../../utils/productImage";

export function subscribeStoreProducts(storeId, callback) {
  if (!storeId) {
    return () => {};
  }
  const q = query(storeProductsCollection(storeId), orderBy("name"));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, storeId, ...d.data() }));
      callback(list);
    },
    (err) => {
      console.error("subscribeStoreProducts", err);
      callback([]);
    }
  );
}

export async function listStoreProducts(storeId) {
  const q = query(storeProductsCollection(storeId), orderBy("name"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, storeId, ...d.data() }));
}

export async function saveStoreProduct(storeId, productId, data, imageFile) {
  const ref = productId
    ? doc(storeProductsCollection(storeId), productId)
    : doc(storeProductsCollection(storeId));

  let productImage = data.productImage || data.existingImage || null;
  if (imageFile) {
    productImage = await fileToProductImageBase64(imageFile);
  }

  const payload = {
    name: String(data.name || "").trim(),
    description: String(data.description || "").trim(),
    category: String(data.category || "").trim(),
    price: Number(data.price) || 0,
    productImage,
    available: data.available !== false,
    stock: Math.max(0, Math.floor(Number(data.stock) || 0)),
    prepTimeMinutes: Math.max(0, Math.floor(Number(data.prepTimeMinutes) || 15)),
    updatedAt: serverTimestamp(),
    ...(productId ? {} : { createdAt: serverTimestamp() }),
  };

  await setDoc(ref, payload, { merge: true });
  return { id: ref.id, storeId, ...payload };
}

export async function deleteStoreProduct(storeId, productId) {
  await deleteDoc(doc(storeProductsCollection(storeId), productId));
}

export function productStock(p) {
  const v = Number(p?.stock);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

export function productPrice(p) {
  const v = Number(p?.price);
  return Number.isFinite(v) ? v : 0;
}
