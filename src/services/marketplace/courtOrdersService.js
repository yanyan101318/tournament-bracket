import { collection, addDoc, serverTimestamp, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { db } from "../../firebase";

const COURT_ORDERS = "courtOrders";

export function courtOrdersCollection() {
  return collection(db, COURT_ORDERS);
}

export async function createCourtOrderPendingApproval(params) {
  const {
    courtId,
    courtName,
    bookingId,
    bookerName,
    bookerUid,
    userId,
    cartGroups,
    cartTotal,
    guestName,
  } = params;

  const payload = {
    courtId: courtId || null,
    courtName: courtName || "Court",
    bookingId: bookingId || null,
    bookerName: bookerName || "Unknown Booker",
    bookerUid: bookerUid || null,
    userId: userId || null,
    guestName: guestName || "Court Guest",
    cartGroups,
    grandTotal: cartTotal,
    amountPaid: 0,
    changeDue: 0,
    status: "pending_approval", // 'pending_approval', 'approved', 'rejected'
    paidAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(courtOrdersCollection(), payload);
  return docRef.id;
}

export function subscribeCourtOrdersByBooking(bookingId, callback) {
  if (!bookingId) return () => {};
  const q = query(
    courtOrdersCollection(),
    where("bookingId", "==", bookingId),
    orderBy("createdAt", "desc")
  );
  
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(list);
    },
    (err) => {
      console.error("subscribeCourtOrdersByBooking error", err);
      callback([]);
    }
  );
}
