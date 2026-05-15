import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, onSnapshot, limit } from "firebase/firestore";
import { db } from "../firebase";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { buildReceiptHtml, formatReceiptCurrency, printReceiptHtml } from "./posReceipt";
import { downloadSalesHistoryPdf, downloadPosReceiptPdf } from "../lib/adminPdfReports";
import Pagination from "./Pagination";

function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  return null;
}

export default function SalesHistoryPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [detail, setDetail] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    const q = query(collection(db, "salesTransactions"), orderBy("createdAt", "desc"), limit(500));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const rangeStart = useMemo(() => {
    const d = new Date(dateFrom + "T00:00:00");
    return Number.isNaN(d.getTime()) ? null : d;
  }, [dateFrom]);

  const rangeEnd = useMemo(() => {
    const d = new Date(dateTo + "T23:59:59.999");
    return Number.isNaN(d.getTime()) ? null : d;
  }, [dateTo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const created = tsToDate(r.createdAt);
      if (rangeStart && created && created < rangeStart) return false;
      if (rangeEnd && created && created > rangeEnd) return false;
      if (!q) return true;
      if (r.id.toLowerCase().includes(q)) return true;
      if ((r.paymentMethod || "").toLowerCase().includes(q)) return true;
      const items = r.items || [];
      return items.some((l) => (l.name || "").toLowerCase().includes(q));
    });
  }, [rows, search, rangeStart, rangeEnd]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function handleSearch(v) { setSearch(v); setPage(1); }
  function handleDateFrom(v) { setDateFrom(v); setPage(1); }
  function handleDateTo(v) { setDateTo(v); setPage(1); }

  if (loading) {
    return (
      <div className="ad-loading">
        <div className="ad-spinner" />
      </div>
    );
  }

  return (
    <div className="ad-page">
      <div className="ad-page-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="ad-page-title">Sales history</h1>
          <p className="ad-page-sub">
            Completed POS transactions from <code className="text-cyan-400">salesTransactions</code>. Booking
            payments are not listed here.
          </p>
        </div>
        <button
          type="button"
          className="ad-btn ad-btn-primary ad-btn-sm shrink-0"
          onClick={() => {
            if (filtered.length === 0) {
              toast.error("No transactions in the current filters to export.");
              return;
            }
            downloadSalesHistoryPdf(filtered, { dateFrom, dateTo }, tsToDate);
            toast.success("PDF report downloaded.");
          }}
        >
          Save PDF report
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-3 lg:items-end flex-wrap">
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-xs font-bold text-[var(--ad-muted)] uppercase tracking-wider">From</label>
          <input
            type="date"
            className="ad-search"
            value={dateFrom}
            onChange={(e) => handleDateFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-xs font-bold text-[var(--ad-muted)] uppercase tracking-wider">To</label>
          <input
            type="date"
            className="ad-search"
            value={dateTo}
            onChange={(e) => handleDateTo(e.target.value)}
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <input
            className="ad-search w-full max-w-none"
            placeholder="Search by receipt ID, product name, payment method…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        <span className="text-sm text-[var(--ad-muted)]">{filtered.length} transaction(s)</span>
      </div>

      <div className="ad-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Date / time</th>
                <th>Transaction</th>
                <th>Items</th>
                <th className="text-right">Total</th>
                <th>Payment</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="ad-empty">
                    No POS sales in this range.
                  </td>
                </tr>
              )}
              {pageRows.map((r) => {
                const dt = tsToDate(r.createdAt);
                const items = r.items || [];
                const summary =
                  items.length <= 2
                    ? items.map((i) => `${i.name} ×${i.quantity}`).join(", ")
                    : `${items[0]?.name} ×${items[0]?.quantity} +${items.length - 1} more`;
                return (
                  <tr key={r.id} className="ad-table-row" onClick={() => setDetail(r)}>
                    <td className="whitespace-nowrap text-xs">
                      {dt ? format(dt, "MMM d, yyyy HH:mm") : "—"}
                    </td>
                    <td className="font-mono text-xs text-cyan-400">{r.id}</td>
                    <td className="text-sm max-w-[280px] truncate" title={summary}>
                      {summary || "—"}
                    </td>
                    <td className="text-right font-mono text-emerald-400">
                      {formatReceiptCurrency(r.total)}
                    </td>
                    <td>{r.paymentMethod || "—"}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="ad-btn ad-btn-outline ad-btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetail(r);
                        }}
                      >
                        Receipt
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />

      {detail && (
        <div className="ad-modal-backdrop" onClick={() => setDetail(null)}>
          <div className="ad-modal max-w-md border-cyan-500/25 shadow-[0_0_40px_rgba(34,211,238,0.15)]" onClick={(e) => e.stopPropagation()}>
            <div className="ad-modal-header">
              <h3>Receipt</h3>
              <button type="button" className="ad-modal-close" onClick={() => setDetail(null)}>
                ✕
              </button>
            </div>
            <div className="ad-modal-form">
              <p className="text-[11px] text-[var(--ad-muted)] font-mono">ID {detail.id}</p>
              <p className="text-sm text-[var(--ad-text)]">
                {(() => {
                  const d = tsToDate(detail.createdAt);
                  return d ? d.toLocaleString() : "—";
                })()}
              </p>
              <ul className="space-y-2 border border-[var(--ad-border)] rounded-lg p-3 bg-[#0f141c] max-h-48 overflow-y-auto custom-scrollbar text-sm">
                {(detail.items || []).map((l, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>
                      {l.name} × {l.quantity}
                    </span>
                    <span className="font-mono">{formatReceiptCurrency(l.lineTotal)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between font-bold text-[var(--ad-text)] pt-2 border-t border-[var(--ad-border)]">
                <span>Total</span>
                <span className="font-mono text-cyan-300">{formatReceiptCurrency(detail.total)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-[var(--ad-muted)] text-xs block">Payment</span>
                  {detail.paymentMethod || "—"}
                </div>
                <div>
                  <span className="text-[var(--ad-muted)] text-xs block">Cash / change</span>
                  <span className="font-mono">
                    {formatReceiptCurrency(detail.cashReceived)} / {formatReceiptCurrency(detail.change)}
                  </span>
                </div>
              </div>
            </div>
            <div className="ad-modal-footer ad-modal-footer-between flex-wrap gap-2">
              <button type="button" className="ad-btn ad-btn-outline" onClick={() => setDetail(null)}>
                Close
              </button>
              <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                className="ad-btn ad-btn-outline"
                onClick={() => {
                  downloadPosReceiptPdf(detail, tsToDate);
                  toast.success("Receipt PDF downloaded.");
                }}
              >
                Save PDF
              </button>
              <button
                type="button"
                className="ad-btn ad-btn-primary"
                onClick={() => {
                  const html = buildReceiptHtml({
                    transactionId: detail.id,
                    createdAt: tsToDate(detail.createdAt) || new Date(),
                    items: detail.items || [],
                    total: detail.total,
                    paymentMethod: detail.paymentMethod,
                    cashReceived: detail.cashReceived,
                    change: detail.change,
                  });
                  printReceiptHtml(html);
                }}
              >
                Print receipt
              </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
