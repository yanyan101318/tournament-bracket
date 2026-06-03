// src/admin/PaymentReview.jsx
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  collection, query, orderBy, onSnapshot,
  doc, updateDoc, deleteDoc, Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useOfflineSync } from "../hooks/useOfflineSync";
import Pagination from "./Pagination";

const CUSTOMER_PAY_BADGE = { paid: "approved", partial: "pending", unpaid: "rejected" };

function toMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function deriveCustomerStatus(row) {
  const explicit = String(row?.customerPaymentStatus || "").toLowerCase().trim();
  if (explicit === "paid" || explicit === "partial" || explicit === "unpaid") return explicit;
  const paid = Number(row?.amountPaid) || 0;
  const rem = Number(row?.remainingBalance);
  if (Number.isFinite(rem)) return rem <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
  return paid > 0 ? "partial" : "unpaid";
}

export default function PaymentReview() {
  const [searchParams] = useSearchParams();
  const view = searchParams.get("view") || "booking";

  const [payments, setPayments] = useState([]);
  const [filter, setFilter]     = useState(() => {
    const v = searchParams.get("view");
    return v === "pending" || v === "approvals" ? "Pending" : "All";
  });
  const [search, setSearch]     = useState("");
  const [loading, setLoading]   = useState(true);
  const [acting, setActing]     = useState(null);
  const [preview, setPreview]   = useState(null); // { payment, imageUrl }
  const { wrapSync } = useOfflineSync();
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "pending" || v === "approvals") setFilter("Pending");
    else setFilter("All");
  }, [searchParams]);

  useEffect(() => {
    const q = query(collection(db,"payments"), orderBy("createdAt","desc"));
    const unsub = onSnapshot(q, { includeMetadataChanges: true }, snap => {
      setPayments(snap.docs.map(d=>({ id:d.id, hasPendingWrites: d.metadata.hasPendingWrites, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const pageTitle =
    filter === "Pending" && view === "approvals"
      ? "Payment approvals"
      : filter === "Pending"
        ? "Pending booking payments"
        : "Booking payments";
  const pageSub =
    filter === "All"
      ? "Court and booking payments only — retail POS sales are under Sales → POS."
      : "Review payment screenshots and approve or reject submitted booking payments.";

  async function setStatus(id, status) {
    setActing(id);
    try {
      const promise = updateDoc(doc(db,"payments",id), {
        paymentStatus: status,
        reviewedAt: Timestamp.now(),
      });
      await wrapSync(promise, {
        successMsg: `Payment ${status}`,
        offlineMsg: "Status Update Saved Offline — Pending Server Sync"
      });
    } catch(err) { console.error(err); }
    setActing(null);
    setPreview(null);
  }

  async function removePayment(id) {
    const row = payments.find((p) => p.id === id) ?? preview;
    const label = row?.name ? `${row.name} — ₱${row.amount ?? "—"}` : "this payment";
    if (
      !window.confirm(
        `Delete this payment record permanently?\n\n${label}\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    setActing(id);
    try {
      await wrapSync(deleteDoc(doc(db, "payments", id)), {
        successMsg: "Payment deleted",
        offlineMsg: "Action Queued for Sync",
        errorMsg: "Could not delete this payment."
      });
    } catch (err) {
      console.error(err);
    }
    setActing(null);
    setPreview(null);
  }

  const filtered = payments.filter(p => {
    const matchFilter = filter==="All" || p.paymentStatus===filter;
    const matchSearch = !search ||
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.method?.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageCards = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function handleFilter(k) { setFilter(k); setPage(1); }
  function handleSearch(v) { setSearch(v); setPage(1); }

  const counts = {
    All:      payments.length,
    Pending:  payments.filter(p=>p.paymentStatus==="Pending").length,
    Approved: payments.filter(p=>p.paymentStatus==="Approved").length,
    Rejected: payments.filter(p=>p.paymentStatus==="Rejected").length,
  };

  const statusColor = { Pending:"pending", Approved:"approved", Rejected:"rejected" };

  if (loading) return <div className="ad-loading"><div className="ad-spinner"/></div>;

  return (
    <div className="ad-page">
      <div className="ad-page-header">
        <div>
          <h1 className="ad-page-title">{pageTitle}</h1>
          <p className="ad-page-sub">{pageSub}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="ad-filter-tabs">
        {Object.entries(counts).map(([k,v])=>(
          <button key={k} className={`ad-filter-tab ${filter===k?"active":""}`} onClick={()=>handleFilter(k)}>
            {k} <span className="ad-filter-count">{v}</span>
          </button>
        ))}
      </div>

      <div className="ad-search-row">
        <input className="ad-search" value={search} onChange={e=>handleSearch(e.target.value)} placeholder="Search by name or method..."/>
        <span className="ad-count">{filtered.length} payment{filtered.length!==1?"s":""}</span>
      </div>

      {/* Payment cards */}
      <div className="pr-grid">
        {filtered.length===0 && <div className="ad-empty">No payments found.</div>}
        {pageCards.map((p) => {
          const payState = deriveCustomerStatus(p);
          return (
          <div key={p.id} className="pr-card">
            {/* Screenshot preview */}
            <div className="pr-img-wrap" onClick={()=>setPreview(p)}>
              {p.paymentImageUrl ? (
                <img src={p.paymentImageUrl} alt="Payment" className="pr-img"/>
              ) : (
                <div className="pr-no-img">No image</div>
              )}
              <div className="pr-img-overlay">🔍 View</div>
            </div>

            <div className="pr-info">
              <div className="pr-name">{p.name ?? "Unknown"}</div>
              <div className="pr-meta">
                <span> {p.method ?? "—"}</span>
                <span>Txn: ₱{toMoney(p.amount)}</span>
              </div>
              <div className="pr-meta">
                <span>📅 {p.date ?? "—"}</span>
                <span> {p.courtName ?? p.courtId ?? "—"}</span>
              </div>
              <div className="pr-meta">
                <span>Paid: ₱{toMoney(p.amountPaid)}</span>
                <span>Bal: ₱{toMoney(p.remainingBalance)}</span>
              </div>
              <div className="pr-meta">
                <span className={`ad-badge ad-badge-${CUSTOMER_PAY_BADGE[payState] ?? "pending"}`}>
                  {payState}
                </span>
                <span className="text-[11px] text-slate-400">
                  {p.paymentPlan === "downpayment"
                    ? "Down payment"
                    : p.paymentPlan === "pay_later"
                      ? "Pay later"
                      : "Full payment"}
                </span>
              </div>
              <span className={`ad-badge ad-badge-${p.hasPendingWrites ? "pending" : (statusColor[p.paymentStatus]??"pending")}`}>
                {p.hasPendingWrites ? "Pending Sync" : (p.paymentStatus ?? "Pending")}
              </span>
            </div>

            <div className="pr-actions">
              {p.paymentStatus !== "Approved" && (
                <button className="ad-btn ad-btn-success ad-btn-sm"
                  disabled={acting===p.id}
                  onClick={()=>setStatus(p.id,"Approved")}>
                  ✓ Approve
                </button>
              )}
              {p.paymentStatus !== "Rejected" && (
                <button className="ad-btn ad-btn-danger ad-btn-sm"
                  disabled={acting===p.id}
                  onClick={()=>setStatus(p.id,"Rejected")}>
                  ✕ Reject
                </button>
              )}
              <button
                type="button"
                className="ad-btn ad-btn-outline ad-btn-sm"
                disabled={acting===p.id}
                onClick={() => removePayment(p.id)}
                title="Remove this payment record"
              >
                Delete
              </button>
            </div>
          </div>
          );
        })}
      </div>
      <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />

      {/* Image preview modal */}
      {preview && (
        <div className="ad-modal-backdrop" onClick={()=>setPreview(null)}>
          <div className="pr-preview-modal" onClick={e=>e.stopPropagation()}>
            <div className="ad-modal-header">
              <h3>Payment Screenshot — {preview.name}</h3>
              <button className="ad-modal-close" onClick={()=>setPreview(null)}>✕</button>
            </div>
            <div className="pr-preview-body">
              {preview.paymentImageUrl ? (
                <img src={preview.paymentImageUrl} alt="Payment screenshot" className="pr-preview-img"/>
              ) : (
                <div className="pr-no-img" style={{height:200}}>No image uploaded</div>
              )}
              <div className="ad-detail-grid" style={{marginTop:"1rem"}}>
                {(() => {
                  const payState = deriveCustomerStatus(preview);
                  return (
                    <>
                <div className="ad-detail-row"><span>Name</span><strong>{preview.name}</strong></div>
                <div className="ad-detail-row"><span>Transaction amount</span><strong>₱{toMoney(preview.amount)}</strong></div>
                <div className="ad-detail-row"><span>Total paid</span><strong>₱{toMoney(preview.amountPaid)}</strong></div>
                <div className="ad-detail-row"><span>Remaining balance</span><strong>₱{toMoney(preview.remainingBalance)}</strong></div>
                <div className="ad-detail-row"><span>Customer pay status</span><strong className="capitalize">{payState}</strong></div>
                <div className="ad-detail-row"><span>Method</span><strong>{preview.method}</strong></div>
                <div className="ad-detail-row"><span>Court</span><strong>{preview.courtName??preview.courtId}</strong></div>
                <div className="ad-detail-row"><span>Date</span><strong>{preview.date}</strong></div>
                <div className="ad-detail-row"><span>Time</span><strong>{preview.timeSlot}</strong></div>
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="ad-modal-footer ad-modal-footer-between">
              <button
                type="button"
                className="ad-btn ad-btn-outline"
                disabled={acting===preview.id}
                onClick={() => removePayment(preview.id)}
              >
                Delete payment
              </button>
              <div className="ad-modal-footer-actions">
                {preview.paymentStatus !== "Approved" && (
                  <button className="ad-btn ad-btn-success" disabled={acting===preview.id} onClick={()=>setStatus(preview.id,"Approved")}>✓ Approve Payment</button>
                )}
                {preview.paymentStatus !== "Rejected" && (
                  <button className="ad-btn ad-btn-danger" disabled={acting===preview.id} onClick={()=>setStatus(preview.id,"Rejected")}>✕ Reject Payment</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}