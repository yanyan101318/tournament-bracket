import { useCallback } from "react";
import { jsPDF } from "jspdf";
import { Printer, Download, X } from "lucide-react";
import RanawLogo from "./RanawLogo";
import { BRAND_MOTTO, BRAND_NAME, buildReceiptLogoHtml } from "../lib/brand";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Printable HTML built from data — does not rely on DOM refs (fixes blank print window in Edge). */
function buildBookingReceiptPrintHtml(receipt) {
  const r = receipt;
  const changeRow =
    r.change != null && r.paymentMethodLabel === "Cash"
      ? `<tr><td>Change</td><td class="right">₱${Number(r.change).toFixed(2)}</td></tr>`
      : "";
  return `
    ${buildReceiptLogoHtml({ maxWidth: "200px", marginBottom: "8px" })}
    <p class="sub" style="text-align:center;font-weight:bold;text-transform:uppercase;margin:0 0 4px 0">Official Booking Receipt</p>
    <p style="text-align:center;font-size:11px;font-style:italic;color:#64748b;margin:0 0 16px 0">${escapeHtml(BRAND_MOTTO)}</p>
    <hr style="border:none;border-bottom:1px dashed #ccc;margin-bottom:16px;" />
    <p class="id">ID: ${escapeHtml(r.transactionId)}</p>
    <table>
      <tbody>
        <tr><td>Date</td><td class="right">${escapeHtml(r.date)}</td></tr>
        <tr><td>Time</td><td class="right">${escapeHtml(r.timeSlot)}</td></tr>
        <tr><td>Court</td><td class="right">${escapeHtml(r.courtName)}</td></tr>
        <tr><td>Duration</td><td class="right">${escapeHtml(String(r.duration))} hr</td></tr>
        <tr><td>Player</td><td class="right">${escapeHtml(r.playerName)}</td></tr>
        <tr><td>Method</td><td class="right">${escapeHtml(r.paymentMethodLabel)}</td></tr>
        <tr><td>Plan</td><td class="right">${escapeHtml(r.paymentPlanLabel)}</td></tr>
        <tr><td>Total</td><td class="right total">₱${Number(r.totalAmount).toFixed(2)}</td></tr>
        <tr><td>Amount paid</td><td class="right">₱${Number(r.amountPaid).toFixed(2)}</td></tr>
        <tr><td>Balance</td><td class="right">₱${Number(r.remainingBalance).toFixed(2)}</td></tr>
        ${changeRow}
      </tbody>
    </table>
    <p class="status">${escapeHtml(String(r.customerPayStatus))}</p>
    <hr style="border:none;border-bottom:1px dashed #ccc;margin:24px 0 16px 0;" />
    <div style="text-align:center;">
      ${buildReceiptLogoHtml({ maxWidth: "160px", marginBottom: "6px" })}
      <div style="font-size:11px;margin-bottom:12px;color:#64748b">Your premier destination for professional pickleball court reservations.</div>
      <div style="font-size:11px;line-height:1.6;color:#333;">
        <div>Phone: [Insert contact]</div>
        <div>Email: [Insert email]</div>
        <div>Location: [Insert address]</div>
      </div>
      <div style="margin-top:16px;font-weight:bold;">THANK YOU!</div>
    </div>
  `;
}

/**
 * @typedef {object} ReceiptModel
 * @property {string} transactionId
 * @property {string} date
 * @property {string} timeSlot
 * @property {string} courtName
 * @property {number} duration
 * @property {string} playerName
 * @property {string} paymentMethodLabel
 * @property {string} paymentPlanLabel
 * @property {number} totalAmount
 * @property {number} amountPaid
 * @property {number} remainingBalance
 * @property {number|null} [change]
 * @property {string} customerPayStatus
 */

function statusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
  if (s === "partial") return "bg-amber-500/20 text-amber-300 border-amber-500/30";
  return "bg-slate-600/30 text-slate-300 border-slate-500/30";
}

/**
 * @param {{ receipt: ReceiptModel, onDismiss?: () => void, className?: string }} props
 */
export default function BookingReceipt({ receipt, onDismiss, className = "" }) {
  const handlePrint = useCallback(() => {
    // Omit noopener: some browsers (Edge) block document.write on opaque opener windows → blank tab.
    const w = window.open("", "_blank", "width=480,height=720");
    if (!w) {
      window.alert("Pop-up blocked. Allow pop-ups for this site to print.");
      return;
    }
    const bodyInner = buildBookingReceiptPrintHtml(receipt);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${BRAND_NAME} RECEIPT</title>
      <style>
        @page { margin: 12mm; }
        body{margin:0;padding:24px;background:#fff;color:#0f172a;font:14px system-ui,sans-serif;}
        h4{font-size:18px;margin:0;color:#0f172a;}
        .sub{color:#64748b;font-size:12px;margin:4px 0 8px;}
        .id{color:#64748b;font-size:11px;font-family:ui-monospace;word-break:break-all;margin-bottom:16px;}
        table{width:100%;border-collapse:collapse;}
        td{padding:8px 0;border-bottom:1px solid #e2e8f0;}
        td:first-child{color:#64748b;width:42%;}
        td.right{text-align:right;font-weight:500;}
        .total{font-weight:700;color:#15803d;}
        .status{margin-top:16px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#475569;}
      </style></head><body>${bodyInner}</body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
    const runPrint = () => {
      try {
        w.focus();
        w.print();
      } finally {
        w.addEventListener(
          "afterprint",
          () => {
            try {
              w.close();
            } catch {
              /* ignore */
            }
          },
          { once: true }
        );
        setTimeout(() => {
          try {
            if (!w.closed) w.close();
          } catch {
            /* ignore */
          }
        }, 2000);
      }
    };
    // Let Edge/Chromium finish parsing before print dialog
    setTimeout(runPrint, 100);
  }, [receipt]);

  const handlePdf = useCallback(() => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const line = 18;
    let y = 48;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`${BRAND_NAME} — Booking receipt`, 48, y);
    y += line * 1.2;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120);
    doc.text(`Transaction: ${receipt.transactionId}`, 48, y);
    y += line;
    doc.text(`Date: ${receipt.date} · ${receipt.timeSlot}`, 48, y);
    y += line * 2;
    doc.setTextColor(30);
    const rows = [
      ["Court", receipt.courtName],
      ["Duration", `${receipt.duration} hr`],
      ["Player", receipt.playerName],
      ["Payment", receipt.paymentMethodLabel],
      ["Plan", receipt.paymentPlanLabel],
      ["Total", `₱${receipt.totalAmount.toFixed(2)}`],
      ["Amount paid", `₱${receipt.amountPaid.toFixed(2)}`],
      ["Balance", `₱${receipt.remainingBalance.toFixed(2)}`],
    ];
    if (receipt.change != null && receipt.paymentMethodLabel === "Cash") {
      rows.push(["Change", `₱${receipt.change.toFixed(2)}`]);
    }
    rows.push(["Status", receipt.customerPayStatus]);
    for (const [k, v] of rows) {
      doc.text(`${k}:`, 48, y);
      doc.text(String(v), 200, y);
      y += line;
    }
    doc.save(`booking-receipt-${receipt.transactionId.slice(0, 8)}.pdf`);
  }, [receipt]);

  const r = receipt;

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-white font-semibold text-sm tracking-wide uppercase">Receipt</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-green-500/50 hover:text-white transition-colors"
          >
            <Printer size={14} /> Print
          </button>
          <button
            type="button"
            onClick={handlePdf}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-500/50 hover:text-white transition-colors"
          >
            <Download size={14} /> PDF
          </button>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center gap-1 rounded-lg p-2 text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="booking-receipt-print-root rounded-xl border border-slate-700 bg-slate-900/60 p-5 text-left text-sm">
        <RanawLogo variant="receipt" className="mb-2" />
        <p className="text-slate-500 text-xs mt-1 mb-4 uppercase font-bold tracking-wider">Official Booking Receipt</p>
        <p className="text-slate-400 text-xs font-mono break-all mb-4">ID: {r.transactionId}</p>
        <table className="w-full text-sm">
          <tbody className="text-slate-300">
            <tr className="border-b border-slate-700/80">
              <td className="py-2 text-slate-500">Date</td>
              <td className="py-2 text-right text-white">{r.date}</td>
            </tr>
            <tr className="border-b border-slate-700/80">
              <td className="py-2 text-slate-500">Time</td>
              <td className="py-2 text-right text-white">{r.timeSlot}</td>
            </tr>
            <tr className="border-b border-slate-700/80">
              <td className="py-2 text-slate-500">Court</td>
              <td className="py-2 text-right text-white">{r.courtName}</td>
            </tr>
            <tr className="border-b border-slate-700/80">
              <td className="py-2 text-slate-500">Duration</td>
              <td className="py-2 text-right text-white">{r.duration} hr</td>
            </tr>
            <tr className="border-b border-slate-700/80">
              <td className="py-2 text-slate-500">Player</td>
              <td className="py-2 text-right text-white">{r.playerName}</td>
            </tr>
            <tr className="border-b border-slate-700/80">
              <td className="py-2 text-slate-500">Method</td>
              <td className="py-2 text-right text-white">{r.paymentMethodLabel}</td>
            </tr>
            <tr className="border-b border-slate-700/80">
              <td className="py-2 text-slate-500">Plan</td>
              <td className="py-2 text-right text-white">{r.paymentPlanLabel}</td>
            </tr>
            <tr className="border-b border-slate-700/80">
              <td className="py-2 text-slate-500">Total</td>
              <td className="py-2 text-right text-green-400 font-semibold">₱{r.totalAmount.toFixed(2)}</td>
            </tr>
            <tr className="border-b border-slate-700/80">
              <td className="py-2 text-slate-500">Amount paid</td>
              <td className="py-2 text-right text-white">₱{r.amountPaid.toFixed(2)}</td>
            </tr>
            <tr className="border-b border-slate-700/80">
              <td className="py-2 text-slate-500">Balance</td>
              <td className="py-2 text-right text-amber-300">₱{r.remainingBalance.toFixed(2)}</td>
            </tr>
            {r.change != null && r.paymentMethodLabel === "Cash" && (
              <tr className="border-b border-slate-700/80">
                <td className="py-2 text-slate-500">Change</td>
                <td className="py-2 text-right text-emerald-300">₱{r.change.toFixed(2)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="mt-4 flex justify-end">
          <span
            className={`inline-block rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${statusBadgeClass(r.customerPayStatus)}`}
          >
            {r.customerPayStatus}
          </span>
        </div>
      </div>
    </div>
  );
}
