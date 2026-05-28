import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase";
import { FOODCOURT_PATH } from "../../marketplace/constants";

const CONFIG_REF = doc(db, "foodCourtConfig", "globalQR");

export function foodCourtPublicUrl(origin = typeof window !== "undefined" ? window.location.origin : "") {
  return `${origin}${FOODCOURT_PATH}`;
}

export async function getFoodCourtConfig() {
  const snap = await getDoc(CONFIG_REF);
  if (!snap.exists()) {
    return {
      title: "RANAW Food Court",
      subtitle: "Scan to order from all stalls",
      publicPath: FOODCOURT_PATH,
    };
  }
  return { id: snap.id, ...snap.data() };
}

export function subscribeFoodCourtConfig(callback) {
  return onSnapshot(CONFIG_REF, (snap) => {
    if (!snap.exists()) {
      callback({
        title: "RANAW Food Court",
        subtitle: "Scan to order from all stalls",
        publicPath: FOODCOURT_PATH,
      });
    } else callback({ id: snap.id, ...snap.data() });
  });
}

export async function saveFoodCourtConfig(data) {
  await setDoc(
    CONFIG_REF,
    {
      title: data.title || "RANAW Food Court",
      subtitle: data.subtitle || "",
      publicPath: FOODCOURT_PATH,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
