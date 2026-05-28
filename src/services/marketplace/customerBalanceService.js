import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { db } from "../../firebase";
import { roundMoney } from "../../lib/bookingMoney";
import { PAYMENT_STATUS, CUSTOMER_ORDER_STATUS } from "../../marketplace/constants";

const BALANCES = "customerBalances";

export function balanceDocRef(userId) {
  return doc(db, BALANCES, userId);
}

export async function getCustomerBalance(userId) {
  const snap = await getDoc(balanceDocRef(userId));
  if (!snap.exists()) return { outstandingBalance: 0, payLaterOrderIds: [] };
  const d = snap.data();
  return {
    outstandingBalance: roundMoney(d.outstandingBalance || 0),
    payLaterOrderIds: d.payLaterOrderIds || [],
  };
}

export function subscribeCustomerBalance(userId, callback) {
  if (!userId) return () => {};
  return onSnapshot(balanceDocRef(userId), (snap) => {
    if (!snap.exists()) callback({ outstandingBalance: 0, payLaterOrderIds: [] });
    else {
      const d = snap.data();
      callback({
        outstandingBalance: roundMoney(d.outstandingBalance || 0),
        payLaterOrderIds: d.payLaterOrderIds || [],
      });
    }
  });
}

export function subscribePayLaterOrders(userId, callback) {
  if (!userId) return () => {};
  const q = query(collection(db, "customerOrders"), where("userId", "==", userId));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(
          (o) =>
            o.paymentStatus === PAYMENT_STATUS.BILLED ||
            o.status === CUSTOMER_ORDER_STATUS.BILLED
        )
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      callback(list);
    },
    () => callback([])
  );
}

/** Add pay-later order amount to customer account. */
export async function addToCustomerBalance(userId, customerOrderId, amount) {
  const amt = roundMoney(amount);
  const ref = balanceDocRef(userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      userId,
      outstandingBalance: amt,
      payLaterOrderIds: [customerOrderId],
      updatedAt: serverTimestamp(),
    });
  } else {
    await updateDoc(ref, {
      outstandingBalance: increment(amt),
      payLaterOrderIds: [...(snap.data().payLaterOrderIds || []), customerOrderId],
      updatedAt: serverTimestamp(),
    });
  }
}

/** Settle full or partial balance at admin POS. */
export async function settleCustomerBalance(userId, { amount, paymentMethod, cashierName, orderIds = [] }) {
  const ref = balanceDocRef(userId);
  const snap = await getDoc(ref);
  const current = snap.exists() ? roundMoney(snap.data().outstandingBalance || 0) : 0;
  const pay = roundMoney(amount);
  const newBal = roundMoney(Math.max(0, current - pay));

  await updateDoc(ref, {
    outstandingBalance: newBal,
    payLaterOrderIds: newBal <= 0 ? [] : (snap.data()?.payLaterOrderIds || []).filter((id) => !orderIds.includes(id)),
    updatedAt: serverTimestamp(),
  });

  await addDoc(collection(db, "customerBalancePayments"), {
    userId,
    amount: pay,
    paymentMethod,
    cashierName,
    orderIds,
    previousBalance: current,
    newBalance: newBal,
    createdAt: serverTimestamp(),
  });

  return { previousBalance: current, newBalance: newBal };
}
