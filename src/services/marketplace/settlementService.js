import {
  collection,
  doc,
  getDocs,
  updateDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebase";
import { roundMoney } from "../../lib/bookingMoney";
import { PAYOUT_STATUS } from "../../marketplace/constants";

export function subscribeVendorPayouts(callback) {
  const q = query(collection(db, "vendorPayouts"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function markPayoutPaid(payoutId) {
  await updateDoc(doc(db, "vendorPayouts", payoutId), {
    status: PAYOUT_STATUS.PAID,
    paidAt: serverTimestamp(),
  });
}

/** Aggregate per-store stats from paid customer orders */
export async function getStoreSalesSummary(storeId) {
  const snap = await getDocs(
    query(collection(db, "customerOrders"), orderBy("createdAt", "desc"))
  );
  let totalSales = 0;
  let orderCount = 0;
  let commission = 0;
  let net = 0;

  snap.docs.forEach((d) => {
    const data = d.data();
    if (data.status !== "paid" && data.paymentStatus !== "paid") return;
    const block = (data.storeBreakdown || []).find((b) => b.storeId === storeId);
    if (!block) return;
    const settlement = (data.settlements || []).find((s) => s.storeId === storeId);
    orderCount += 1;
    totalSales = roundMoney(totalSales + (block.subtotal || 0));
    if (settlement) {
      commission = roundMoney(commission + (settlement.commission || 0));
      net = roundMoney(net + (settlement.vendorNet || 0));
    }
  });

  return { totalSales, orderCount, commission, net };
}
