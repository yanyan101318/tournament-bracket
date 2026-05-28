import { useState, useEffect } from "react";
import { subscribeVendorPayouts, markPayoutPaid } from "../../services/marketplace/settlementService";
import { subscribeStores } from "../../services/marketplace/storesService";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { roundMoney } from "../../lib/bookingMoney";

export default function VendorSettlementsPage() {
  const [payouts, setPayouts] = useState([]);
  const [stores, setStores] = useState([]);

  useEffect(() => {
    document.title = "RANAW PICKLEBALL COURT | Vendor Settlements";
    let cancelled = false;
    const u1 = subscribeVendorPayouts((list) => {
      if (!cancelled) setPayouts(list);
    });
    const u2 = subscribeStores((list) => {
      if (!cancelled) setStores(list);
    });
    return () => {
      cancelled = true;
      u1();
      u2();
    };
  }, []);

  const storeName = (id) => stores.find((s) => s.id === id)?.name || id;

  return (
    <div className="ad-page">
      <div className="ad-page-header">
        <div>
          <h1 className="ad-page-title">Vendor Settlements</h1>
          <p className="ad-page-sub">Commission breakdown and payout status per marketplace order.</p>
        </div>
      </div>

      <div className="ad-card">
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Order</th>
                <th>Stalls</th>
                <th>Gross</th>
                <th>Commission</th>
                <th>Vendor net</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payouts.length === 0 && (
                <tr>
                  <td colSpan={8} className="ad-empty">
                    No marketplace payouts yet.
                  </td>
                </tr>
              )}
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.createdAt?.toDate
                      ? format(p.createdAt.toDate(), "MMM d, yyyy h:mm a")
                      : "—"}
                  </td>
                  <td className="font-mono text-xs">{p.customerOrderId?.slice(0, 8)}…</td>
                  <td>
                    <div className="text-xs space-y-1">
                      {(p.settlements || []).map((s, i) => (
                        <div key={i}>
                          {storeName(s.storeId)}: ₱{roundMoney(s.vendorNet).toFixed(2)}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>₱{roundMoney(p.grandTotal).toFixed(2)}</td>
                  <td>₱{roundMoney(p.totalCommission).toFixed(2)}</td>
                  <td>₱{roundMoney(p.totalVendorNet).toFixed(2)}</td>
                  <td>
                    <span className={`ad-badge ad-badge-${p.status === "paid" ? "approved" : "pending"}`}>
                      {p.status || "pending"}
                    </span>
                  </td>
                  <td>
                    {p.status !== "paid" && (
                      <button
                        type="button"
                        className="ad-btn ad-btn-sm ad-btn-success"
                        onClick={() =>
                          markPayoutPaid(p.id).then(() => toast.success("Marked paid"))
                        }
                      >
                        Mark paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
