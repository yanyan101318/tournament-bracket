import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { roundMoney } from "../lib/bookingMoney";
import Pagination from "./Pagination";

export default function CrmPage() {
  const [customers, setCustomers] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    const q = query(collection(db, "customers"), orderBy("updatedAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "bookings"), orderBy("createdAt", "desc")),
      (snap) => setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    return () => unsub();
  }, []);

  const historyForSelected = useMemo(() => {
    if (!selected?.userId) return [];
    return bookings
      .filter((b) => b.userId === selected.userId)
      .slice(0, 40);
  }, [bookings, selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      const spent = Number(c.totalAmountSpent) || 0;
      const matchFilter =
        filter === "All" ||
        (filter === "Active" && (Number(c.totalBookings) || 0) > 0) ||
        (filter === "High value" && spent >= 5000);
      const matchSearch =
        !q ||
        (c.fullName || "").toLowerCase().includes(q) ||
        (c.contactNumber || "").includes(q) ||
        (c.email || "").toLowerCase().includes(q);
      return matchFilter && matchSearch;
    });
  }, [customers, search, filter]);

  // Reset page when filters change
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function handleFilter(k) { setFilter(k); setPage(1); }
  function handleSearch(v) { setSearch(v); setPage(1); }

  if (loading) {
    return (
      <div className="ad-loading">
        <div className="ad-spinner" />
      </div>
    );
  }

  return (
    <div className="ad-page">
      <div className="ad-page-header">
        <div>
          <h1 className="ad-page-title">Customers (CRM)</h1>
          <p className="ad-page-sub">Profiles updated automatically from bookings.</p>
        </div>
      </div>

      <div className="ad-filter-tabs">
        {["All", "Active", "High value"].map((k) => (
          <button key={k} type="button" className={`ad-filter-tab ${filter === k ? "active" : ""}`} onClick={() => handleFilter(k)}>
            {k}
          </button>
        ))}
      </div>

      <div className="ad-search-row">
        <input
          className="ad-search"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search name, phone, or email…"
        />
        <span className="ad-count">
          {filtered.length} customer{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="ad-card">
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Bookings</th>
                <th>Total spent</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="ad-empty">
                    No customers yet — they appear after the first booking.
                  </td>
                </tr>
              )}
              {pageRows.map((c) => (
                <tr key={c.id} className="ad-table-row cursor-pointer" onClick={() => setSelected(c)}>
                  <td className="ad-td-main">{c.fullName ?? "—"}</td>
                  <td>{c.contactNumber ?? "—"}</td>
                  <td>{c.email || "—"}</td>
                  <td>{c.totalBookings ?? 0}</td>
                  <td>₱{roundMoney(Number(c.totalAmountSpent) || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />

      {selected && (
        <div className="ad-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="ad-modal ad-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="ad-modal-header">
              <h3>{selected.fullName}</h3>
              <button type="button" className="ad-modal-close" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
            <div className="ad-detail-grid">
              <div className="ad-detail-row">
                <span>Phone</span>
                <strong>{selected.contactNumber ?? "—"}</strong>
              </div>
              <div className="ad-detail-row">
                <span>Email</span>
                <strong>{selected.email || "—"}</strong>
              </div>
              <div className="ad-detail-row">
                <span>Bookings</span>
                <strong>{selected.totalBookings ?? 0}</strong>
              </div>
              <div className="ad-detail-row">
                <span>Total spent</span>
                <strong>₱{roundMoney(Number(selected.totalAmountSpent) || 0).toFixed(2)}</strong>
              </div>
            </div>
            <h4 className="text-sm font-bold text-white mt-4 mb-2">Booking history</h4>
            <div className="max-h-56 overflow-y-auto border border-slate-800 rounded-lg">
              <table className="ad-table text-xs">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Court</th>
                    <th>Total</th>
                    <th>Pay status</th>
                  </tr>
                </thead>
                <tbody>
                  {historyForSelected.length === 0 && (
                    <tr>
                      <td colSpan={4} className="ad-empty">
                        No bookings for this profile.
                      </td>
                    </tr>
                  )}
                  {historyForSelected.map((b) => (
                    <tr key={b.id}>
                      <td>{b.date ?? "—"}</td>
                      <td>{b.courtName ?? b.courtId}</td>
                      <td>₱{roundMoney(Number(b.totalAmount ?? b.amountPaid ?? 0)).toFixed(2)}</td>
                      <td className="capitalize">{b.customerPaymentStatus ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ad-modal-footer">
              <button type="button" className="ad-btn ad-btn-outline" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
