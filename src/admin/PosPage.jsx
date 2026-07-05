import { useState, useEffect, useMemo } from "react";
import {
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  writeBatch,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import toast from "react-hot-toast";
import { buildReceiptHtml, printReceiptHtml } from "./posReceipt";
import { formatReceiptCurrency } from "./posReceipt";
import FoodCourtPosLayout from "./FoodCourtPosLayout";
import { format } from "date-fns";
import { useOfflineSync } from "../hooks/useOfflineSync";
import { createFoodCourtOrder } from "../services/marketplace/customerOrdersService";
import { CUSTOMER_TYPE, PAYMENT_MODE, ORDER_SOURCE } from "../marketplace/constants";

function CourtOrderCheckoutCard({ order }) {
  const [cash, setCash] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isPaid = order.status === "PAID" || order.status === "paid" || order.status === "waived";
  const isWaived = order.status === "waived" || order.waived === true;
  
  const grandTotal = Number(order.grandTotal) || 0;
  const cashAmount = Number(cash) || 0;
  const changeDue = Math.max(0, cashAmount - grandTotal);
  
  let displayStatus = order.status?.replace(/_/g, " ").toUpperCase() || "PENDING";
  if (order.status === "sent_to_stalls") displayStatus = "PENDING FOR PAYMENT";
  if (isPaid && !isWaived) displayStatus = "PAID";
  if (isWaived) displayStatus = "WAIVED";

  let statusClass = "bg-amber-500/20 text-amber-400 border border-amber-500/50";
  if (isPaid || isWaived) statusClass = "bg-[#84CC16]/20 text-[#84CC16] border border-[#84CC16]/50";

  async function handleMarkPaid() {
    if (cashAmount < grandTotal) {
       toast.error("Cash received must be at least the total amount.");
       return;
    }
    setSubmitting(true);
    try {
       const batch = writeBatch(db);
       
       const orderRef = doc(db, "courtOrders", order.id);
       batch.update(orderRef, { status: "PAID", paidAt: serverTimestamp(), amountPaid: cashAmount, changeDue: changeDue });
       
       const flattenedItems = [];
       if (order.cartGroups) {
         Object.values(order.cartGroups).forEach(group => {
           if (group.items) {
             group.items.forEach(item => flattenedItems.push(item));
           }
         });
       }
       
       const txRef = doc(collection(db, "salesTransactions"));
       batch.set(txRef, {
         type: "pos",
         source: "court_order",
         orderId: order.id,
         customerName: order.bookerName || order.guestName || "Guest",
         vendorName: "Court Food Orders",
         items: flattenedItems,
         total: grandTotal,
         paymentMethod: "Cash",
         cashReceived: cashAmount,
         change: changeDue,
         createdAt: serverTimestamp(),
       });
       
       await batch.commit();
       
       const receiptPayload = {
         transactionId: txRef.id,
         createdAt: new Date(),
         items: flattenedItems,
         total: grandTotal,
         paymentMethod: "Cash",
         cashReceived: cashAmount,
         change: changeDue,
         source: "court_order",
         headerTitle: "RANAW FOOD COURT · Court Snacks",
         headerLines: [
           order.courtName || order.courtId || "Court",
           order.bookerName ? `Booker: ${order.bookerName}` : "",
           order.id ? `Order: ${order.id}` : "",
         ].filter(Boolean),
       };
       printReceiptHtml(buildReceiptHtml(receiptPayload));
       
       toast.success("Order marked as PAID!");
       setCash("");
    } catch(e) {
       console.error(e);
       toast.error("Failed to update payment");
    } finally {
       setSubmitting(false);
    }
  }

  async function handleWaive() {
    if (!window.confirm("Are you sure you want to waive this order? No charge will be collected.")) return;
    setSubmitting(true);
    try {
       await updateDoc(doc(db, "courtOrders", order.id), { status: "waived", waived: true, paidAt: serverTimestamp() });
       toast.success("Order waived!");
    } catch(e) {
       console.error(e);
       toast.error("Failed to waive order");
    } finally {
       setSubmitting(false);
    }
  }

  return (
    <div className="bg-[#0F172A] border border-slate-700 rounded-xl overflow-hidden shadow-lg mt-4">
      <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
        <h4 className="font-bold text-white tracking-wide">Court Food Orders</h4>
        <span className={`text-[10px] font-bold tracking-wider px-2 py-1 rounded ${statusClass}`}>
          {displayStatus}
        </span>
      </div>
      
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
          <div>
            <span className="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-0.5">Booker</span>
            <span className="text-white font-medium">{order.bookerName || "—"}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-0.5">Ordered By (Guest)</span>
            <span className="text-white font-medium">{order.guestName || "—"}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-0.5">Court</span>
            <span className="text-white font-medium">{order.courtName || order.courtId || "—"}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-0.5">Placed At</span>
            <span className="text-slate-300">{order.createdAt?.toDate ? format(order.createdAt.toDate(), "MMM d, h:mm a") : "—"}</span>
          </div>
        </div>

        <div className="border border-slate-800 rounded-lg p-3 bg-slate-900/30">
          {Object.values(order.cartGroups || {}).map((group, idx, arr) => (
            <div key={group.storeId} className={idx !== arr.length - 1 ? "border-b border-slate-800/60 pb-3 mb-3" : ""}>
              <div className="text-xs font-bold text-[#84CC16] mb-2">{group.storeName}</div>
              <div className="space-y-1.5">
                {group.items?.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm hover:bg-slate-800/30 px-1 -mx-1 rounded transition-colors">
                    <span className="text-slate-300">
                      <span className="text-slate-500 mr-1">{item.quantity}x</span> {item.name}
                    </span>
                    <span className="text-slate-400 font-mono">
                      ₱{item.unitPrice?.toFixed(2)} = <span className="text-slate-300 font-medium">₱{item.lineTotal?.toFixed(2)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center py-2 border-b border-slate-800">
          <span className="font-bold text-slate-300">Grand Total</span>
          <span className="text-xl font-black text-[#84CC16]">₱{grandTotal.toFixed(2)}</span>
        </div>

        {!isPaid ? (
          <div className="pt-2 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[10px] uppercase tracking-wide text-slate-500 font-bold block mb-1">Cash Received</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">₱</span>
                  <input
                    type="number"
                    min={grandTotal}
                    step="0.01"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 focus:border-[#84CC16] outline-none text-white rounded-lg pl-8 pr-3 py-2 text-sm transition-colors"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex-1 bg-slate-900/50 rounded-lg p-2 border border-slate-800 flex flex-col justify-center">
                <span className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Change Due</span>
                <span className="text-[#84CC16] font-mono font-bold text-lg leading-tight">₱{changeDue.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                className="flex-[2] bg-[#84CC16] hover:bg-[#65a30d] text-[#0F172A] font-bold py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                onClick={handleMarkPaid}
                disabled={submitting || cashAmount < grandTotal}
              >
                {submitting ? "Processing..." : "Mark as Paid & Print Receipt"}
              </button>
              <button
                className="flex-1 bg-transparent hover:bg-slate-800 text-slate-400 font-semibold py-2.5 px-4 rounded-lg border border-slate-700 transition-colors disabled:opacity-50"
                onClick={handleWaive}
                disabled={submitting}
              >
                Waive/No Charge
              </button>
            </div>
          </div>
        ) : (
          <div className="pt-2">
            <div className="bg-[#84CC16]/10 border border-[#84CC16]/20 rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#84CC16]/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-[#84CC16]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                </div>
                <div>
                  <div className="text-[#84CC16] font-bold">Payment Completed</div>
                  <div className="text-xs text-[#84CC16]/70">{isWaived ? "Waived (No Charge)" : `Paid At: ${order.paidAt?.toDate ? format(order.paidAt.toDate(), "MMM d, h:mm a") : "—"}`}</div>
                </div>
              </div>
              <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BookingCourtOrders({ booking }) {
  const [orders, setOrders] = useState([]);
  
  useEffect(() => {
    if (!booking?.id) return;
    const q = query(collection(db, "courtOrders"), where("bookingId", "==", booking.id));
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      });
      setOrders(list);
    });
    return () => unsub();
  }, [booking?.id]);

  if (orders.length === 0) return null;

  return (
    <>
      {orders.map(order => <CourtOrderCheckoutCard key={order.id} order={order} />)}
    </>
  );
}


function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export default function PosPage() {
  const [activeTab, setActiveTab] = useState("foodcourt");
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [courtOrderPayModal, setCourtOrderPayModal] = useState(null);
  const [courtOrderCashReceived, setCourtOrderCashReceived] = useState("");
  const { wrapSync, syncState } = useOfflineSync();

  useEffect(() => {
    document.title = "RANAW PICKLEBALL COURT | POS";
    const qOrders = query(collection(db, "courtOrders"), orderBy("createdAt", "desc"));
    const qProducts = query(collection(db, "products"), orderBy("name"));
    const u1 = onSnapshot(
      qOrders,
      (snap) => setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("Orders listener error:", err)
    );
    const u2 = onSnapshot(
      qProducts,
      (snap) => setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("Products listener error:", err)
    );
    return () => {
      u1();
      u2();
    };
  }, []);

  const courtOrderChangeDue = useMemo(() => {
    if (!courtOrderPayModal) return 0;
    const cash = Number(courtOrderCashReceived) || 0;
    return Math.max(0, roundMoney(cash - (courtOrderPayModal.totalAmount || 0)));
  }, [courtOrderPayModal, courtOrderCashReceived]);

  async function updateCourtOrderStatus(orderId, status) {
    try {
      await updateDoc(doc(db, "courtOrders", orderId), { status, updatedAt: serverTimestamp() });
      toast.success(`Order marked as ${status}`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to update status");
    }
  }

  async function confirmCourtOrder(courtOrder) {
    try {
      await createFoodCourtOrder({
        storeGroups: courtOrder.cartGroups,
        customerType: CUSTOMER_TYPE.REGISTERED,
        paymentMode: PAYMENT_MODE.PAY_LATER,
        customerName: `${courtOrder.bookerName} (Court: ${courtOrder.courtName})`,
        bookingId: courtOrder.bookingId,
        courtId: courtOrder.courtId,
        courtName: courtOrder.courtName,
        orderSource: ORDER_SOURCE.COURT_QR,
      });

      await updateDoc(doc(db, "courtOrders", courtOrder.id), {
        status: "sent_to_stalls",
        updatedAt: serverTimestamp()
      });

      toast.success("Order sent to stalls!");
    } catch (e) {
      console.error(e);
      toast.error("Failed to send order to stalls");
    }
  }

  async function submitCourtOrderPay(e) {
    e.preventDefault();
    if (!courtOrderPayModal) return;
    const order = courtOrderPayModal;
    const cash = Number(courtOrderCashReceived) || 0;

    if (cash < order.totalAmount) {
      toast.error("Cash received must be at least the total amount.");
      return;
    }

    try {
      const batch = writeBatch(db);

      const txRef = doc(collection(db, "salesTransactions"));
      batch.set(txRef, {
        type: "pos",
        source: "court_order",
        orderId: order.id,
        items: order.items,
        total: order.totalAmount,
        paymentMethod: "Cash",
        cashReceived: cash,
        change: courtOrderChangeDue,
        createdAt: serverTimestamp(),
      });

      for (const line of order.items || []) {
        const p = products.find((x) => x.id === line.productId);
        if (!p) continue;
        const usesStock = Object.prototype.hasOwnProperty.call(p, "stock");
        const ref = doc(db, "products", line.productId);
        batch.update(ref, {
          [usesStock ? "stock" : "quantity"]: increment(-line.quantity),
          updatedAt: serverTimestamp(),
        });
      }

      batch.update(doc(db, "orders", order.id), { status: "paid" });

      await wrapSync(batch.commit(), {
        successMsg: "Order paid and stock updated",
        offlineMsg: "Payment queued for sync",
        errorMsg: "Checkout failed",
      });

      const receiptPayload = {
        transactionId: txRef.id,
        createdAt: new Date(),
        items: order.items || [],
        total: order.totalAmount,
        paymentMethod: "Cash",
        cashReceived: cash,
        change: courtOrderChangeDue,
        source: "court_order",
        headerTitle: "RANAW FOOD COURT · Court Snacks",
        headerLines: [
          order.courtName || order.courtId || "Court",
          order.playerName ? `Player: ${order.playerName}` : "",
          order.id ? `Order: ${order.id}` : "",
        ].filter(Boolean),
      };
      setLastReceipt(receiptPayload);
      printReceiptHtml(buildReceiptHtml(receiptPayload));

      setCourtOrderPayModal(null);
      setCourtOrderCashReceived("");
    } catch (err) {
      console.error(err);
      toast.error("Payment failed");
    }
  }

  return (
    <div className="ad-page">
      <div className="ad-page-header">
        <div>
          <h1 className="ad-page-title">Food court POS</h1>
          <p className="ad-page-sub">
            Marketplace payment + dispatch center and court snacks cashiering.
          </p>
        </div>
      </div>

      <div className="flex gap-4 mb-6 border-b border-[var(--ad-border)]">
        <button
          type="button"
          className={`pb-2 px-1 text-sm font-bold transition-colors ${activeTab === "foodcourt"
              ? "text-cyan-400 border-b-2 border-cyan-400"
              : "text-slate-400 hover:text-slate-300"
            }`}
          onClick={() => setActiveTab("foodcourt")}
        >
          Marketplace POS
        </button>
        <button
          type="button"
          className={`pb-2 px-1 text-sm font-bold transition-colors ${activeTab === "courtOrders"
              ? "text-cyan-400 border-b-2 border-cyan-400"
              : "text-slate-400 hover:text-slate-300"
            }`}
          onClick={() => setActiveTab("courtOrders")}
        >
          Court Orders
        </button>
      </div>

      {activeTab === "foodcourt" && <FoodCourtPosLayout />}

      {activeTab === "courtOrders" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT SIDE: Confirm Orders */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-cyan-400 border-b border-slate-800 pb-2">Orders to Confirm</h2>
            {orders.filter((o) => o.status === "approved").length === 0 ? (
              <div className="ad-empty border border-dashed border-[var(--ad-border)] rounded-xl py-12">
                No approved court orders. Orders must be approved by the booker first.
              </div>
            ) : (
              <div className="space-y-4">
                {orders
                  .filter((o) => o.status === "approved")
                  .map((order) => (
                    <div
                      key={order.id}
                      className="bg-[var(--ad-surface)] border border-[var(--ad-border)] rounded-xl p-4 flex flex-col shadow-sm"
                    >
                      <div className="flex justify-between items-start mb-3 border-b border-[var(--ad-border)] pb-3">
                        <div>
                          <h3 className="font-bold text-[var(--ad-text)]">{order.courtName || order.courtId}</h3>
                          <p className="text-xs text-cyan-400 font-semibold mb-1">Booker: {order.bookerName}</p>
                          <p className="text-xs text-[var(--ad-muted)]">Guest: {order.guestName}</p>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/50">
                          Approved
                        </span>
                      </div>

                      <div className="flex-1 mb-4 space-y-2 max-h-40 overflow-y-auto pr-1">
                        {Object.values(order.cartGroups || {}).map(group => (
                          <div key={group.storeId} className="mb-2">
                            <p className="text-xs font-bold text-[#84CC16] mb-1">{group.storeName}</p>
                            {group.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between text-sm pl-2 border-l-2 border-[var(--ad-border)]">
                                <span className="text-[var(--ad-text)]">
                                  {item.quantity}x {item.name}
                                </span>
                                <span className="text-[var(--ad-muted)]">
                                  {formatReceiptCurrency(item.lineTotal || 0)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-between items-center font-bold border-t border-[var(--ad-border)] pt-3 mb-4">
                        <span className="text-[var(--ad-text)]">Total</span>
                        <span className="text-emerald-400">
                          {formatReceiptCurrency(order.grandTotal || 0)}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2 mt-auto">
                        <button
                          className="ad-btn ad-btn-sm ad-btn-primary flex-1 justify-center"
                          onClick={() => confirmCourtOrder(order)}
                        >
                          Confirm & Send to Stalls
                        </button>
                        <button
                          className="ad-btn ad-btn-sm ad-btn-danger justify-center"
                          onClick={() => updateCourtOrderStatus(order.id, "rejected_by_admin")}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* RIGHT SIDE: Checkout / Payment */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-emerald-400 border-b border-slate-800 pb-2">Checkout / Payment</h2>
            {orders.filter((o) => o.status === "sent_to_stalls").length === 0 ? (
              <div className="ad-empty border border-dashed border-[var(--ad-border)] rounded-xl py-12">
                No orders pending payment.
              </div>
            ) : (
              <div className="space-y-4">
                {orders
                  .filter((o) => o.status === "sent_to_stalls")
                  .map(order => (
                    <CourtOrderCheckoutCard key={order.id} order={order} />
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {courtOrderPayModal && (
        <div
          className="ad-modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && syncState === "idle" && setCourtOrderPayModal(null)}
        >
          <div className="ad-modal max-w-md shadow-[0_0_40px_rgba(34,211,238,0.12)] border-cyan-500/20">
            <div className="ad-modal-header">
              <h3>Pay Court Order</h3>
              <button
                type="button"
                className="ad-modal-close"
                onClick={() => syncState === "idle" && setCourtOrderPayModal(null)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={submitCourtOrderPay} className="ad-modal-form">
              <div className="rounded-lg border border-[var(--ad-border)] p-3 space-y-2 text-sm mb-4">
                <div className="text-[var(--ad-text)] font-bold mb-2 pb-2 border-b border-[var(--ad-border)]">
                  {courtOrderPayModal.courtName || courtOrderPayModal.courtId} - {courtOrderPayModal.playerName}
                </div>
                {courtOrderPayModal.items?.map((l, idx) => (
                  <div key={idx} className="flex justify-between gap-2">
                    <span className="text-[var(--ad-muted)]">
                      {l.name} × {l.quantity}
                    </span>
                    <span className="font-mono">{formatReceiptCurrency(l.lineTotal)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold pt-2 border-t border-[var(--ad-border)]">
                  <span>Total</span>
                  <span className="font-mono text-cyan-300">
                    {formatReceiptCurrency(courtOrderPayModal.totalAmount)}
                  </span>
                </div>
              </div>

              <div className="af-group">
                <label className="af-label">Cash received</label>
                <input
                  className="af-input"
                  type="number"
                  min={courtOrderPayModal.totalAmount}
                  step={0.01}
                  value={courtOrderCashReceived}
                  onChange={(e) => setCourtOrderCashReceived(e.target.value)}
                  required
                />
              </div>
              <p className="text-sm font-mono text-emerald-400 mb-2">
                Change: {formatReceiptCurrency(courtOrderChangeDue)}
              </p>

              <div className="ad-modal-footer">
                <button
                  type="button"
                  className="ad-btn ad-btn-outline"
                  onClick={() => setCourtOrderPayModal(null)}
                  disabled={syncState !== "idle" && syncState !== "error"}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="ad-btn ad-btn-primary"
                  disabled={syncState !== "idle" && syncState !== "error"}
                >
                  {syncState === "syncing" ? "Processing…" : "Confirm & print receipt"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
