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
import { useOfflineSync } from "../hooks/useOfflineSync";

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
    const qOrders = query(collection(db, "orders"), orderBy("createdAt", "desc"));
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

  async function updateOrderStatus(orderId, status) {
    try {
      await updateDoc(doc(db, "orders", orderId), { status });
      toast.success(`Order marked as ${status}`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to update status");
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
          className={`pb-2 px-1 text-sm font-bold transition-colors ${
            activeTab === "foodcourt"
              ? "text-cyan-400 border-b-2 border-cyan-400"
              : "text-slate-400 hover:text-slate-300"
          }`}
          onClick={() => setActiveTab("foodcourt")}
        >
          Marketplace POS
        </button>
        <button
          type="button"
          className={`pb-2 px-1 text-sm font-bold transition-colors ${
            activeTab === "courtOrders"
              ? "text-cyan-400 border-b-2 border-cyan-400"
              : "text-slate-400 hover:text-slate-300"
          }`}
          onClick={() => setActiveTab("courtOrders")}
        >
          Court snacks
        </button>
      </div>

      {activeTab === "foodcourt" && <FoodCourtPosLayout />}

      {activeTab === "courtOrders" && (
        <div className="space-y-4">
          {lastReceipt?.source === "court_order" && (
            <div className="rounded-xl border border-[var(--ad-border)] bg-[var(--ad-surface)] p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-bold text-[var(--ad-text)]">Last court order receipt</span>
                <span className="text-[var(--ad-muted)] ml-2 font-mono text-xs">{lastReceipt.transactionId}</span>
              </div>
              <button
                type="button"
                className="ad-btn ad-btn-outline ad-btn-sm"
                onClick={() => printReceiptHtml(buildReceiptHtml(lastReceipt))}
              >
                Print again
              </button>
            </div>
          )}
          {orders.filter((o) => ["approved", "preparing", "served"].includes(o.status)).length === 0 ? (
            <div className="ad-empty border border-dashed border-[var(--ad-border)] rounded-xl py-12">
              No active court orders. Wait for players to scan their QR codes and order.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {orders
                .filter((o) => ["approved", "preparing", "served"].includes(o.status))
                .map((order) => (
                  <div
                    key={order.id}
                    className="bg-[var(--ad-surface)] border border-[var(--ad-border)] rounded-xl p-4 flex flex-col"
                  >
                    <div className="flex justify-between items-start mb-3 border-b border-[var(--ad-border)] pb-3">
                      <div>
                        <h3 className="font-bold text-[var(--ad-text)]">{order.courtName || order.courtId}</h3>
                        <p className="text-xs text-cyan-400 font-semibold">{order.playerName}</p>
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                          order.status === "approved"
                            ? "bg-red-500/20 text-red-400 border border-red-500/50"
                            : order.status === "preparing"
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/50"
                              : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50"
                        }`}
                      >
                        {order.status}
                      </span>
                    </div>

                    <div className="flex-1 mb-4 space-y-2">
                      {order.items?.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-sm">
                          <span className="text-[var(--ad-text)]">
                            {item.quantity}x {item.name}
                          </span>
                          <span className="text-[var(--ad-muted)]">
                            {formatReceiptCurrency(item.lineTotal || 0)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-between items-center font-bold border-t border-[var(--ad-border)] pt-3 mb-4">
                      <span className="text-[var(--ad-text)]">Total</span>
                      <span className="text-emerald-400">
                        {formatReceiptCurrency(order.totalAmount || 0)}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-auto">
                      {order.status === "approved" && (
                        <button
                          className="ad-btn ad-btn-sm ad-btn-primary flex-1 justify-center"
                          onClick={() => updateOrderStatus(order.id, "preparing")}
                        >
                          Prepare
                        </button>
                      )}
                      {order.status === "preparing" && (
                        <button
                          className="ad-btn ad-btn-sm ad-btn-success flex-1 justify-center"
                          onClick={() => updateOrderStatus(order.id, "served")}
                        >
                          Serve
                        </button>
                      )}
                      {order.status === "served" && (
                        <button
                          className="ad-btn ad-btn-sm ad-btn-success flex-1 justify-center"
                          onClick={() => {
                            setCourtOrderPayModal(order);
                            setCourtOrderCashReceived(String(order.totalAmount || ""));
                          }}
                        >
                          Pay (Cash)
                        </button>
                      )}
                      <button
                        className="ad-btn ad-btn-sm ad-btn-danger justify-center"
                        onClick={() => updateOrderStatus(order.id, "cancelled")}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
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
