/**
 * Professional PDF exports for admin (equipment inventory + POS sales history).
 * Uses jsPDF only — no extra packages.
 */
import { jsPDF } from "jspdf";
import { format } from "date-fns";

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

