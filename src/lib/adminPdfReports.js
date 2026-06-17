/**
 * Professional PDF exports for admin (equipment inventory + POS sales history).
 * Uses jsPDF only — no extra packages.
 */
import { jsPDF } from "jspdf";
import { format } from "date-fns";
import { formatReceiptCurrency } from "../admin/posReceipt";

const MARGIN = 14;
const PAGE_W = 210;
const CONTENT_W = PAGE_W - MARGIN * 2;

function moneyPlain(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return "0.00";
  return v.toFixed(2);
}

function truncate(str, max) {
  const s = String(str ?? "");
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function drawBrandedHeader(doc, titleLine, subtitleLine) {
  doc.setFillColor(10, 15, 24);
  doc.rect(0, 0, PAGE_W, 34, "F");
  doc.setDrawColor(124, 58, 237);
  doc.setLineWidth(0.4);
  doc.line(0, 34, PAGE_W, 34);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("RANAW PICKLEBALL", MARGIN, 14);
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  doc.setFont("helvetica", "normal");
  doc.text("COURT", MARGIN + 58, 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(titleLine, MARGIN, 24);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(subtitleLine || "", MARGIN, 30);
  doc.setTextColor(15, 23, 42);
}

function drawFooter(doc, pageIndex, totalPages) {
  const y = 287;
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Page ${pageIndex} / ${totalPages}`, MARGIN, y);
  doc.text("RANAW PICKLEBALL COURT", PAGE_W - MARGIN, y, { align: "right" });
}

function finalizeDoc(doc, filenameBase) {
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    drawFooter(doc, i, total);
  }
  doc.save(`${filenameBase}-${format(new Date(), "yyyy-MM-dd-HHmm")}.pdf`);
}

/**
 * @param {{ items: Array<object>, stats: { totalSkus: number, availableUnits: number, activeCount: number, overdueCount: number } }} payload
 */
export function downloadEquipmentInventoryPdf(payload) {
  const { items = [], stats = {} } = payload || {};
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const subtitle = [
    `Generated ${format(new Date(), "MMM d, yyyy HH:mm")}`,
    `${stats.totalSkus ?? 0} SKU • ${stats.availableUnits ?? 0} units available`,
    `${stats.activeCount ?? 0} active borrows • ${stats.overdueCount ?? 0} overdue`,
  ].join(" • ");
  drawBrandedHeader(doc, "Equipment inventory report", subtitle);

  let y = 44;
  const rows = [...items].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })
  );

  const colX = [MARGIN, MARGIN + 52, MARGIN + 92, MARGIN + 118, MARGIN + 138, MARGIN + 164];
  const hdr = ["Item", "Category", "Total", "Avail.", "₱/hr", "Type"];

  function tableHeader() {
    doc.setFillColor(241, 245, 249);
    doc.rect(MARGIN, y - 5, CONTENT_W, 8, "F");
    doc.setDrawColor(226, 232, 240);
    doc.rect(MARGIN, y - 5, CONTENT_W, 8, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    hdr.forEach((h, i) => doc.text(h, colX[i], y));
    doc.setFont("helvetica", "normal");
    y += 8;
  }

  tableHeader();

  rows.forEach((it, idx) => {
    if (y > 268) {
      doc.addPage();
      drawBrandedHeader(doc, "Equipment inventory report", "(continued)");
      y = 44;
      tableHeader();
    }
    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(MARGIN, y - 4.5, CONTENT_W, 7.5, "F");
    }
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(truncate(it.name, 34), colX[0], y);
    doc.text(truncate(it.category, 14), colX[1], y);
    doc.text(String(it.totalQty ?? "—"), colX[2], y);
    doc.text(String(it.availableQty ?? "—"), colX[3], y);
    doc.text(moneyPlain(it.pricePerHour), colX[4], y);
    doc.text(truncate(it.type || "—", 12), colX[5], y);
    y += 7.5;
  });

  if (rows.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("No equipment rows to export.", MARGIN, y);
  }

  finalizeDoc(doc, "equipment-inventory");
}

/**
 * @param {object[]} rows — filtered salesTransactions
 * @param {{ dateFrom: string, dateTo: string }} range — yyyy-MM-dd
 * @param {(ts: unknown) => Date | null} tsToDate
 */
export function downloadSalesHistoryPdf(rows, range, tsToDate) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const rangeLabel = `${range.dateFrom} → ${range.dateTo}`;
  drawBrandedHeader(
    doc,
    "Sales history — transactions & receipts",
    `POS sales • ${rangeLabel} • ${rows.length} transaction(s) • Generated ${format(new Date(), "MMM d, yyyy HH:mm")}`
  );

  let y = 44;
  const colX = [MARGIN, MARGIN + 42, MARGIN + 118, MARGIN + 158, MARGIN + 178];
  const hdr = ["Date / time", "Transaction ID", "Summary", "Payment", "Total"];

  function tableHeader() {
    doc.setFillColor(241, 245, 249);
    doc.rect(MARGIN, y - 5, CONTENT_W, 8, "F");
    doc.setDrawColor(226, 232, 240);
    doc.rect(MARGIN, y - 5, CONTENT_W, 8, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    hdr.forEach((h, i) => doc.text(h, colX[i], y));
    doc.setFont("helvetica", "normal");
    y += 8;
  }

  tableHeader();

  rows.forEach((r, idx) => {
    if (y > 262) {
      doc.addPage();
      drawBrandedHeader(doc, "Sales history — transactions & receipts", "(continued)");
      y = 44;
      tableHeader();
    }
    const dt = tsToDate(r.createdAt);
    const dateStr = dt ? format(dt, "MMM d, yyyy HH:mm") : "—";
    const items = r.items || [];
    const summary =
      items.length <= 2
        ? items.map((i) => `${truncate(i.name, 24)} ×${i.quantity}`).join(", ")
        : `${truncate(items[0]?.name, 20)} ×${items[0]?.quantity} +${items.length - 1} more`;

    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(MARGIN, y - 4.5, CONTENT_W, 14, "F");
    }
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(dateStr, colX[0], y);
    doc.setFont("courier", "normal");
    doc.setFontSize(7);
    doc.text(truncate(r.id, 24), colX[1], y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    const sumLines = doc.splitTextToSize(summary || "—", 62);
    doc.text(sumLines, colX[2], y);
    doc.text(truncate(r.paymentMethod || "—", 14), colX[3], y);
    doc.setFont("helvetica", "bold");
    doc.text(formatReceiptCurrency(r.total).replace("₱", ""), colX[4], y);
    doc.setFont("helvetica", "normal");
    y += Math.max(14, sumLines.length * 3.8);
  });

  if (rows.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("No transactions in this export.", MARGIN, y);
  }

  finalizeDoc(doc, "sales-history");
}

/**
 * POS receipt — compact professional layout on A4 (thermal-style block).
 */
export function downloadPosReceiptPdf(detail, tsToDate) {
  const doc = new jsPDF({ unit: "mm", format: [80, 160], orientation: "portrait" });
  const w = 80;
  let y = 8;
  doc.setFillColor(10, 15, 24);
  doc.rect(0, 0, w, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("RANAW PICKLEBALL COURT", w / 2, 8, { align: "center" });
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(203, 213, 225);
  doc.text("Sales receipt", w / 2, 12, { align: "center" });

  y = 20;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(7);
  doc.text(`Txn ${detail.id}`, 5, y);
  y += 4;
  const dt = tsToDate(detail.createdAt);
  doc.setTextColor(71, 85, 105);
  doc.text(dt ? dt.toLocaleString() : "—", 5, y);
  y += 7;

  doc.setDrawColor(226, 232, 240);
  doc.line(5, y, w - 5, y);
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text("ITEM", 5, y);
  doc.text("QTY", 42, y);
  doc.text("AMT", 62, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);

  for (const l of detail.items || []) {
    const lineTotal =
      l.lineTotal ?? (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0);
    const nameLines = doc.splitTextToSize(String(l.name || "—"), 34);
    doc.text(nameLines, 5, y);
    doc.text(String(l.quantity ?? ""), 42, y);
    doc.text(formatReceiptCurrency(lineTotal).replace("₱", ""), 62, y);
    y += Math.max(6, nameLines.length * 3.2);
    if (y > 145) {
      doc.addPage();
      y = 10;
    }
  }

  y += 4;
  doc.line(5, y, w - 5, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("TOTAL", 5, y);
  doc.text(formatReceiptCurrency(detail.total), 75, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(`Payment: ${detail.paymentMethod || "—"}`, 5, y);
  y += 4;
  doc.text(
    `Cash ${formatReceiptCurrency(detail.cashReceived)} • Change ${formatReceiptCurrency(detail.change)}`,
    5,
    y
  );

  doc.setFontSize(6.5);
  doc.setTextColor(148, 163, 184);
  doc.text("Thank you for your purchase.", w / 2, 154, { align: "center" });

  doc.save(`receipt-${truncate(detail.id, 18)}-${format(new Date(), "yyyy-MM-dd-HHmm")}.pdf`);
}
