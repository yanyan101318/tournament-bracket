import { useState, useEffect, useMemo } from "react";
import {
  collection,
  doc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import toast from "react-hot-toast";
import {
  subscribeMarketplaceOrders,
  payCustomerOrderAtPos,
  rejectCustomerOrder,
  subscribeVendorOrders,
  markVendorOrderTransferred,
} from "../services/marketplace/customerOrdersService";
import { subscribeStores } from "../services/marketplace/storesService";
import { buildReceiptHtml, printReceiptHtml } from "./posReceipt";
import { roundMoney } from "../lib/bookingMoney";
import { useOfflineSync } from "../hooks/useOfflineSync";
import { useAuth } from "../auth/AuthContext";
import {
  CUSTOMER_ORDER_STATUS,
  DISPATCH_STATUS,
  ORDER_SOURCE,
  PAYMENT_MODE,
  PAYMENT_STATUS,
  VENDOR_ORDER_STATUS,
  VENDOR_ORDER_STATUS_LABELS,
  customerTypeLabel,
  paymentModeLabel,
} from "../marketplace/constants";

export default function FoodCourtPosLayout() {
  const [orders, setOrders] = useState([]);
  const [stores, setStores] = useState([]);
  const [selected, setSelected] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [cashReceived, setCashReceived] = useState("");
  const [paying, setPaying] = useState(false);
  const [successModal, setSuccessModal] = useState(null);
  const [kitchenByStore, setKitchenByStore] = useState({});
  const { wrapSync } = useOfflineSync();
  const { profile } = useAuth();

  useEffect(() => {
    const u1 = subscribeMarketplaceOrders(setOrders);
    const u2 = subscribeStores(setStores);
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    const unsubs = stores.map((s) =>
      subscribeVendorOrders(s.id, (list) => {
        setKitchenByStore((prev) => ({ ...prev, [s.id]: list }));
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [stores]);

  const commissionMap = useMemo(() => {
    const m = {};
    stores.forEach((s) => {
      m[s.id] = Number(s.commissionRate) || 0;
    });
    return m;
  }, [stores]);

  const { onlineQueue, walkinQueue } = useMemo(() => {
    const pending = orders.filter((o) => {
      if (o.dispatchStatus !== DISPATCH_STATUS.BLOCKED) return false;
      if (o.paymentMode === PAYMENT_MODE.GCASH) {
        return o.paymentStatus === PAYMENT_STATUS.PAID;
      }
      return o.status === CUSTOMER_ORDER_STATUS.AWAITING_PAYMENT || o.status === CUSTOMER_ORDER_STATUS.PENDING_PAYMENT;
    });

    return {
      onlineQueue: pending.filter((o) => o.orderSource !== ORDER_SOURCE.WALK_IN),
    };
  }, [orders]);

  const queueOrders = onlineQueue;

  const breakdown = useMemo(() => {
    if (!selected) return null;
    const blocks = (selected.storeBreakdown || []).map((block) => {
      const rate = commissionMap[block.storeId] || 0;
      const gross = roundMoney(block.subtotal);
      const commission = roundMoney(gross * (rate / 100));
      const vendorNet = roundMoney(gross - commission);
      return { ...block, rate, gross, commission, vendorNet };
    });
    const totalCommission = roundMoney(blocks.reduce((s, b) => s + b.commission, 0));
    const totalVendorNet = roundMoney(blocks.reduce((s, b) => s + b.vendorNet, 0));
    return { blocks, totalCommission, totalVendorNet };
  }, [selected, commissionMap]);

  const changeDue = useMemo(() => {
    if (!selected || paymentMethod !== "Cash") return 0;
    const cash = Number(cashReceived) || 0;
    return Math.max(0, roundMoney(cash - (selected.grandTotal || 0)));
  }, [selected, cashReceived, paymentMethod]);

  const allKitchen = useMemo(() => {
    const rows = [];
    for (const store of stores) {
      for (const o of kitchenByStore[store.id] || []) {
        rows.push({ ...o, storeName: store.name });
      }
    }
    return rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  }, [stores, kitchenByStore]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const o of allKitchen) {
        const doneMs = o.completedAt?.toMillis?.();
        if (!doneMs) continue;
        if (o.transferredAt) continue;
        if (now - doneMs >= 15000) {
          markVendorOrderTransferred(o.storeId, o.id).catch(() => { });
        }
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [allKitchen]);

  const kitchenGroups = useMemo(() => {
    const g = {
      [VENDOR_ORDER_STATUS.PENDING]: [],
      [VENDOR_ORDER_STATUS.PREPARING]: [],
      [VENDOR_ORDER_STATUS.READY]: [],
    };
    for (const o of allKitchen) {
      if (o.transferredAt) continue;
      if (o.status === VENDOR_ORDER_STATUS.ACCEPTED) {
        g[VENDOR_ORDER_STATUS.PENDING].push(o);
      } else if (g[o.status]) {
        g[o.status].push(o);
      }
    }
    return g;
  }, [allKitchen]);

  useEffect(() => {
    if (selected?.paymentMode === PAYMENT_MODE.GCASH) {
      setPaymentMethod("GCash");
    } else {
      setPaymentMethod("Cash");
    }
  }, [selected]);


  async function handlePay() {
    if (!selected || !breakdown) return;
    setPaying(true);
    try {
      const { verificationCode } = await payCustomerOrderAtPos({
        customerOrder: selected,
        paymentMethod,
        cashierName: profile?.name || "Admin",
        commissionByStore: commissionMap,
      });

      const batch = writeBatch(db);
      const txnRef = doc(collection(db, "salesTransactions"));
      const lineItems = [];
      for (const block of selected.storeBreakdown || []) {
        for (const it of block.items || []) {
          lineItems.push({
            name: `${block.storeName}: ${it.name}`,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            lineTotal: it.lineTotal,
          });
        }
      }
      batch.set(txnRef, {
        type: "marketplace",
        source: "foodcourt",
        customerOrderId: selected.id,
        items: lineItems,
        subtotal: selected.subtotal,
        serviceFee: selected.serviceFee || 0,
        total: selected.grandTotal,
        paymentMethod,
        cashReceived: paymentMethod === "Cash" ? Number(cashReceived) || 0 : null,
        change: changeDue,
        verificationCode,
        customerName: selected.customerName,
        orderId: selected.id,
        vendorName: (selected.storeBreakdown || []).map((s) => s.storeName).join(", "),
        paymentStatus: "paid",
        createdAt: serverTimestamp(),
      });
      const receiptRef = doc(collection(db, "receipts"));
      batch.set(receiptRef, {
        transactionId: txnRef.id,
        orderId: selected.id,
        customerName: selected.customerName,
        items: lineItems,
        total: selected.grandTotal,
        paymentMethod,
        cashReceived: paymentMethod === "Cash" ? Number(cashReceived) || 0 : null,
        change: changeDue,
        createdAt: serverTimestamp(),
      });
      await wrapSync(batch.commit(), { successMsg: "Payment confirmed & sent to vendors" });

      if (paymentMethod !== "GCash") {
        const html = buildReceiptHtml({
          headerTitle: "RANAW FOOD COURT",
          headerLines: [`Customer: ${selected.customerName}`, `Verify: ${verificationCode}`],
          items: lineItems,
          total: selected.grandTotal,
          paymentMethod,
          footerNote: "Thank you!",
        });
        printReceiptHtml(html);
      }
      setSuccessModal({ id: selected.id, amount: selected.grandTotal });
      setSelected(null);
      setCashReceived("");
    } catch (e) {
      console.error(e);
      toast.error("Payment failed");
    } finally {
      setPaying(false);
    }
  }

  async function handleReject() {
    if (!selected) return;
    try {
      await rejectCustomerOrder(selected.id);
      toast.success("Order rejected");
      setSelected(null);
    } catch {
      toast.error("Could not reject");
    }
  }

  return (
    <div className="fc-pos-layout">
      <div className="fc-pos-col fc-pos-queue">
        <h3 className="fc-pos-heading mb-3">Incoming orders</h3>
        <div className="fc-pos-scroll">
          {queueOrders.length === 0 && (
            <div className="text-center text-slate-500 text-sm p-6 border border-dashed border-slate-700 rounded-xl">
              <div className="text-3xl mb-2">🧾</div>
              No incoming orders right now.
            </div>
          )}
          {queueOrders.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`fc-pos-order-card w-full text-left ${selected?.id === o.id ? "fc-pos-order-card--active" : ""}`}
              onClick={() => setSelected(o)}
            >
              <div className="flex justify-between items-start gap-2">
                <span className="text-[10px] font-mono text-slate-500">#{o.id.slice(0, 8)}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">
                  {customerTypeLabel(o.customerType)}
                </span>
              </div>
              <div className="font-semibold text-white mt-1">{o.customerName}</div>
              <div className="text-xs text-slate-500">
                {(o.storeBreakdown || []).map((b) => b.storeName).join(", ")}
              </div>
              <div className="text-emerald-400 font-mono font-bold mt-1">
                ₱{roundMoney(o.grandTotal).toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-600 mt-1">{paymentModeLabel(o.paymentMode)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="fc-pos-col fc-pos-pay">
        <h3 className="fc-pos-heading">Payment & checkout</h3>
        {!selected ? (
          <div className="text-center text-slate-500 text-sm p-6 border border-dashed border-slate-700 rounded-xl">
            <div className="text-3xl mb-2">💳</div>
            Select an order to process payment.
          </div>
        ) : (
          <div className="fc-pos-scroll p-1">
            {breakdown?.blocks.map((b) => (
              <div key={b.storeId} className="mkp-cart-group mb-2">
                <div className="text-xs font-bold text-cyan-400">{b.storeName}</div>
                {b.items?.map((it, i) => (
                  <div key={i} className="flex justify-between text-sm text-slate-300">
                    <span>
                      {it.quantity}× {it.name}
                    </span>
                    <span>₱{it.lineTotal?.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="border-t border-slate-700 pt-3 space-y-1 text-sm mb-4">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>₱{roundMoney(selected.subtotal).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Service fee</span>
                <span>₱{roundMoney(selected.serviceFee || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-emerald-400">
                <span>Total</span>
                <span>₱{roundMoney(selected.grandTotal).toFixed(2)}</span>
              </div>


            </div>
            <label className="af-label">Payment</label>
            <select
              className="af-input w-full mb-3"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option>Cash</option>
              <option>GCash</option>
              <option>Card</option>
            </select>
            {paymentMethod === "Cash" && (
              <>
                <label className="af-label">Cash received</label>
                <input
                  className="af-input w-full mb-2"
                  type="number"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                />
                <p className="text-sm text-cyan-400 mb-3">Change: ₱{changeDue.toFixed(2)}</p>
              </>
            )}
            <button
              type="button"
              className="ad-btn ad-btn-primary w-full mb-2"
              disabled={paying}
              onClick={handlePay}
            >
              {paying ? "Processing…" : (paymentMethod === "GCash" ? "Confirm dispatch" : "Confirm payment & dispatch")}
            </button>
            <button type="button" className="ad-btn w-full text-red-400" onClick={handleReject}>
              Reject order
            </button>
          </div>
        )}
      </div>

      <div className="fc-pos-col fc-pos-kitchen">
        <h3 className="fc-pos-heading">Live kitchen</h3>
        <div className="fc-pos-scroll space-y-4">
          {[
            VENDOR_ORDER_STATUS.PENDING,
            VENDOR_ORDER_STATUS.PREPARING,
            VENDOR_ORDER_STATUS.READY,
          ].map((status) => (
            <div key={status}>
              <h4 className="text-xs font-bold uppercase mb-2 flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${status === VENDOR_ORDER_STATUS.PENDING
                    ? "bg-orange-400"
                    : status === VENDOR_ORDER_STATUS.PREPARING
                      ? "bg-blue-400"
                      : status === VENDOR_ORDER_STATUS.READY
                        ? "bg-emerald-400"
                        : "bg-slate-500"
                    }`}
                />
                {VENDOR_ORDER_STATUS_LABELS[status]} ({kitchenGroups[status]?.length || 0})
              </h4>
              {(kitchenGroups[status] || []).slice(0, 8).map((o) => (
                <div key={o.id} className="mkp-vendor-order-card text-sm">
                  <div className="flex justify-between">
                    <span className="font-bold text-cyan-400">{o.storeName}</span>
                    <span className="text-[10px] text-slate-500">{o.paymentBadge}</span>
                  </div>
                  <div className="text-white">{o.customerName}</div>
                  <div className="text-xs text-slate-500">
                    {o.items?.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {successModal && (
        <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl p-6 text-center max-w-sm w-full">
            <div className="text-5xl mb-3">✅</div>
            <h4 className="text-white font-bold text-lg mb-1">Payment successful</h4>
            <p className="text-slate-400 text-sm mb-4">
              Order #{successModal.id.slice(0, 8)} paid: ₱{roundMoney(successModal.amount).toFixed(2)}
            </p>
            <button type="button" className="ad-btn ad-btn-primary w-full" onClick={() => setSuccessModal(null)}>
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
