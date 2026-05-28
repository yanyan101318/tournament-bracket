import { useState, useEffect, useMemo } from "react";
import {
  collection,
  doc,
  addDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import toast from "react-hot-toast";
import { subscribePendingCustomerOrders, payCustomerOrderAtPos } from "../services/marketplace/customerOrdersService";
import { subscribeStores } from "../services/marketplace/storesService";
import { buildReceiptHtml, printReceiptHtml } from "./posReceipt";
import { roundMoney } from "../lib/bookingMoney";
import { useOfflineSync } from "../hooks/useOfflineSync";
import { useAuth } from "../auth/AuthContext";

function roundMoneyLocal(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export default function PosMarketplaceTab() {
  const [orders, setOrders] = useState([]);
  const [stores, setStores] = useState([]);
  const [selected, setSelected] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paying, setPaying] = useState(false);
  const { wrapSync } = useOfflineSync();
  const { profile } = useAuth();

  useEffect(() => {
    let cancelled = false;
    let u1 = () => {};
    let u2 = () => {};
    try {
      u1 = subscribePendingCustomerOrders((list) => {
        if (!cancelled) setOrders(list);
      });
      u2 = subscribeStores((list) => {
        if (!cancelled) setStores(list);
      });
    } catch (e) {
      console.error(e);
    }
    return () => {
      cancelled = true;
      u1();
      u2();
    };
  }, []);

  const commissionMap = useMemo(() => {
    const m = {};
    stores.forEach((s) => {
      m[s.id] = Number(s.commissionRate) || 0;
    });
    return m;
  }, [stores]);

  const breakdown = useMemo(() => {
    if (!selected) return null;
    const blocks = (selected.storeBreakdown || []).map((block) => {
      const rate = commissionMap[block.storeId] || 0;
      const gross = roundMoneyLocal(block.subtotal);
      const commission = roundMoneyLocal(gross * (rate / 100));
      const vendorNet = roundMoneyLocal(gross - commission);
      return { ...block, rate, gross, commission, vendorNet };
    });
    const totalCommission = roundMoneyLocal(blocks.reduce((s, b) => s + b.commission, 0));
    const totalVendorNet = roundMoneyLocal(blocks.reduce((s, b) => s + b.vendorNet, 0));
    return { blocks, totalCommission, totalVendorNet };
  }, [selected, commissionMap]);

  async function handlePay() {
    if (!selected || !breakdown) return;
    setPaying(true);
    try {
      const { verificationCode, settlements } = await payCustomerOrderAtPos({
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
        source: "customer_order",
        customerOrderId: selected.id,
        items: lineItems,
        subtotal: selected.subtotal,
        serviceFee: selected.serviceFee || 0,
        total: selected.grandTotal,
        paymentMethod,
        settlements,
        totalCommission: breakdown.totalCommission,
        totalVendorNet: breakdown.totalVendorNet,
        verificationCode,
        courtId: selected.courtId,
        courtName: selected.courtName,
        createdAt: serverTimestamp(),
      });

      await wrapSync(batch.commit(), {
        successMsg: "Marketplace order paid",
        offlineMsg: "Payment queued for sync",
        errorMsg: "Payment failed",
      });

      const html = buildReceiptHtml({
        headerTitle: "RANAW FOOD COURT",
        headerLines: [
          `Court: ${selected.courtName}`,
          `Customer: ${selected.customerName}`,
          `Verify: ${verificationCode}`,
        ],
        items: lineItems,
        total: selected.grandTotal,
        paymentMethod,
        footerNote: "Pay at counter — marketplace order",
      });
      printReceiptHtml(html);

      setSelected(null);
    } catch (e) {
      console.error(e);
      toast.error("Could not complete payment");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Marketplace orders awaiting payment at the counter. All vendor payments are processed here only.
      </p>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="ad-card p-4 max-h-[70vh] overflow-y-auto">
          <h3 className="font-bold text-white mb-3">Pending payment ({orders.length})</h3>
          {orders.length === 0 && (
            <p className="text-slate-500 text-sm">No pending marketplace orders.</p>
          )}
          {orders.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`w-full text-left p-3 rounded-xl border mb-2 transition-colors ${selected?.id === o.id ? "border-cyan-500 bg-cyan-500/10" : "border-slate-700 bg-slate-900/50 hover:border-slate-600"}`}
              onClick={() => setSelected(o)}
            >
              <div className="font-semibold text-white">{o.courtName}</div>
              <div className="text-xs text-slate-400">{o.customerName}</div>
              <div className="text-emerald-400 font-mono mt-1">₱{roundMoney(o.grandTotal).toFixed(2)}</div>
              <div className="text-[10px] text-slate-500 mt-1">
                {(o.storeBreakdown || []).length} stall(s)
              </div>
            </button>
          ))}
        </div>

        {selected && breakdown && (
          <div className="ad-card p-4">
            <h3 className="font-bold text-white mb-3">Checkout</h3>
            {breakdown.blocks.map((b) => (
              <div key={b.storeId} className="mkp-cart-group mb-2">
                <div className="text-xs font-bold text-cyan-400">{b.storeName}</div>
                {b.items?.map((it, i) => (
                  <div key={i} className="flex justify-between text-sm text-slate-300">
                    <span>{it.quantity}× {it.name}</span>
                    <span>₱{it.lineTotal?.toFixed(2)}</span>
                  </div>
                ))}
                <div className="text-xs text-slate-500 mt-1 flex justify-between">
                  <span>Commission {b.rate}%</span>
                  <span>Vendor net ₱{b.vendorNet.toFixed(2)}</span>
                </div>
              </div>
            ))}
            <div className="border-t border-slate-700 pt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>₱{roundMoney(selected.subtotal).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-amber-400">
                <span>Total commission</span>
                <span>₱{breakdown.totalCommission.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-cyan-400 font-bold text-lg pt-2">
                <span>Grand total</span>
                <span>₱{roundMoney(selected.grandTotal).toFixed(2)}</span>
              </div>
            </div>
            <div className="mt-4">
              <label className="af-label">Payment method</label>
              <select
                className="af-input w-full"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option>Cash</option>
                <option>GCash</option>
                <option>Card</option>
              </select>
            </div>
            <button
              type="button"
              className="ad-btn ad-btn-primary w-full mt-4"
              disabled={paying}
              onClick={handlePay}
            >
              {paying ? "Processing…" : "Confirm payment & print receipt"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
