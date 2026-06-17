/** Shared POS receipt formatting (print + modal). */

import { buildReceiptLogoHtml, BRAND_NAME } from "../lib/brand";

export function formatReceiptCurrency(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return "₱0.00";
  return `₱${v.toFixed(2)}`;
}

export function buildReceiptHtml({
  transactionId,
  createdAt,
  items,
  total,
  paymentMethod,
  cashReceived,
  change,
  headerTitle = "RANAW PICKLEBALL COURT",
  headerLines = [],
}) {
  const when =
    createdAt instanceof Date
      ? createdAt.toLocaleString()
      : createdAt?.toDate?.()?.toLocaleString?.() ?? new Date().toLocaleString();
  const rows =
    items?.map(
      (l) =>
        `<tr><td>${escapeHtml(l.name)}</td><td class="num">${l.quantity}</td><td class="num">${formatReceiptCurrency(l.lineTotal ?? (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0))}</td></tr>`
    ) ?? [];
  const extraHeaderHtml = (headerLines || [])
    .filter(Boolean)
    .map((line) => `<div class="muted">${escapeHtml(line)}</div>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Receipt ${escapeHtml(transactionId)}</title>
<style>
  /* Narrow receipt width + height grows with content (less blank paper on Chromium/Edge) */
  @page {
    margin: 2mm;
    size: 80mm auto;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    color: #0f172a;
    background: #fff;
    font-family: ui-monospace, "Segoe UI", system-ui, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .wrap {
    max-width: 72mm;
    margin: 0 auto;
    padding: 2mm 3mm 3mm;
    font-size: 10px;
    line-height: 1.25;
  }
  .brand-logo {
    display: block;
    margin: 0 auto 3px;
    max-width: 100%;
    width: 58mm;
    height: auto;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 {
    font-size: 11px;
    font-weight: 800;
    margin: 0 0 2px;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .muted {
    color: #64748b;
    font-size: 9px;
    margin: 0 0 2px;
    word-break: break-word;
  }
  .tid {
    font-size: 8px;
    margin: 0 0 4px;
    word-break: break-all;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9px;
  }
  th {
    text-align: left;
    font-weight: 700;
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #475569;
    padding: 2px 0 1px;
    border-bottom: 1px dashed #cbd5e1;
  }
  td {
    padding: 1px 0;
    border-bottom: 1px dotted #e2e8f0;
    vertical-align: top;
  }
  td:first-child {
    padding-right: 4px;
    word-break: break-word;
  }
  td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .sep {
    border: 0;
    border-top: 1px dashed #94a3b8;
    margin: 4px 0;
  }
  .tot {
    margin-top: 3px;
    font-size: 11px;
    font-weight: 800;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin: 1px 0;
    font-size: 9px;
  }
  .row strong {
    font-variant-numeric: tabular-nums;
  }
  @media screen {
    body { background: #f1f5f9; }
    .wrap { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  }
</style></head><body>
<div class="wrap">
${buildReceiptLogoHtml({ maxWidth: "58mm", marginBottom: "3px" })}
${headerTitle !== BRAND_NAME ? `<h1>${escapeHtml(headerTitle)}</h1>` : ""}
<div class="muted">${escapeHtml(when)}</div>
${extraHeaderHtml}
<div class="tid">ID ${escapeHtml(transactionId)}</div>
<table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Amt</th></tr></thead><tbody>${rows.join("")}</tbody></table>
<hr class="sep" />
<div class="tot"><div class="row"><span>TOTAL</span><span>${formatReceiptCurrency(total)}</span></div></div>
<div class="row"><span>Pay</span><strong>${escapeHtml(paymentMethod || "Cash")}</strong></div>
<div class="row"><span>Cash</span><strong>${formatReceiptCurrency(cashReceived)}</strong></div>
<div class="row"><span>Change</span><strong>${formatReceiptCurrency(change)}</strong></div>
</div>
</body></html>`;
}

function escapeHtml(s) {
  const t = String(s ?? "");
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printReceiptHtml(html) {
  try {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const frameDoc = iframe.contentWindow?.document;
    if (!frameDoc) throw new Error("Missing iframe document");

    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    const cleanup = () => {
      setTimeout(() => {
        try {
          iframe.remove();
        } catch {
          /* ignore */
        }
      }, 400);
    };

    const doPrint = () => {
      const imgs = frameDoc.querySelectorAll("img");
      const finish = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          /* ignore */
        } finally {
          cleanup();
        }
      };
      if (!imgs.length) {
        finish();
        return;
      }
      let pending = imgs.length;
      const onImgDone = () => {
        pending -= 1;
        if (pending <= 0) finish();
      };
      imgs.forEach((img) => {
        if (img.complete) onImgDone();
        else {
          img.addEventListener("load", onImgDone, { once: true });
          img.addEventListener("error", onImgDone, { once: true });
        }
      });
      setTimeout(finish, 1500);
    };

    iframe.onload = doPrint;
    setTimeout(doPrint, 250);
    return true;
  } catch {
    return false;
  }
}
