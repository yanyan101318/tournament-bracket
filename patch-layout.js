const fs = require('fs');
let code = fs.readFileSync('kiosk-print-server.js', 'utf-8');

// The new body of buildEscPos
const newBody = `function buildEscPos(data) {
  const {
    receiptId, orderId,
    date,
    customerName,
    customerContact,
    items,
    subtotal,
    discount,
    total,
    paymentMethod,
  } = data;

  const actualReceiptId = receiptId || orderId || "N/A";
  const actualDate = date || new Date().toLocaleString("en-PH");

  const buf = [];
  const wr = (...b) => buf.push(...b);
  const ws = (s) => { for (const c of String(s)) buf.push(c.charCodeAt(0)); };
  
  const MAX_CHARS = 48; // 80mm thermal paper typically fits 48 chars per line

  const wc = (s) => {
    const str = String(s || "").slice(0, MAX_CHARS);
    const pad = Math.max(0, Math.floor((MAX_CHARS - str.length) / 2));
    ws(" ".repeat(pad) + str + "\\n");
  };

  const formatItemLine = (itemStr, qtyStr, totalStr) => {
    const i = String(itemStr).padEnd(30).slice(0, 30);
    const q = String(qtyStr).padStart(6).slice(0, 6);
    const t = String(totalStr).padStart(10).slice(0, 10);
    return \`\${i} \${q} \${t}\`;
  };

  const rightAlign = (label, value) => {
    const rStr = \`\${label} \${value}\`;
    ws(" ".repeat(Math.max(0, MAX_CHARS - rStr.length)) + rStr + "\\n");
  };

  wr(0x1b, 0x40);          // Init

  // Header (Centered)
  if (typeof logoBuf !== 'undefined' && logoBuf) {
    wr(0x1b, 0x61, 0x01); // Center
    for(let i=0; i<logoBuf.length; i++) wr(logoBuf[i]);
    ws("\\n");
  }

  wr(0x1b, 0x61, 0x01);    // Center
  wr(0x1b, 0x21, 0x30);    // Double size
  ws("RANAW FOOD COURT\\n");
  wr(0x1b, 0x21, 0x00);    // Normal size
  ws("\\n");

  // Details (Left Aligned)
  wr(0x1b, 0x61, 0x00);    // Left
  ws(\`\${actualDate}\\n\`);
  ws(\`Customer: \${customerName || customerContact || "Guest"}\\n\`);
  ws(\`Verify: \${actualReceiptId}\\n\`);
  ws("ID\\n");
  ws("\\n");

  // Items Header
  wr(0x1b, 0x45, 0x01); // Bold ON
  ws(formatItemLine("ITEM", "QTY", "AMT") + "\\n");
  wr(0x1b, 0x45, 0x00); // Bold OFF
  ws("------------------------------------------------\\n"); // Separator

  // Items List
  let computedSubtotal = 0;
  for (const it of items || []) {
    const name = it.description || it.name || "Item";
    const qty = it.qty || it.quantity || 1;
    const itemTotal = Number(it.total || it.lineTotal) || 0;
    computedSubtotal += itemTotal;

    ws(formatItemLine(name, qty, "P" + itemTotal.toFixed(2)) + "\\n");
  }

  // Payment Summary
  ws("------------------------------------------------\\n");
  wr(0x1b, 0x45, 0x01); // Bold ON
  rightAlign("TOTAL", "P" + computedSubtotal.toFixed(2));
  wr(0x1b, 0x45, 0x00); // Bold OFF

  const actualPaymentMethod = paymentMethod || "GCash";
  
  rightAlign("Pay", actualPaymentMethod);
  rightAlign("Cash", "P0.00");
  rightAlign("Change", "P0.00");

  ws("\\n");

  // Footer
  wr(0x1b, 0x61, 0x01);    // Center
  ws("Thank you for playing at Ranaw!\\n");
  ws("See you on the court! \\x81\\n");
  ws("\\n\\n\\n\\n");
  wr(0x1d, 0x56, 0x41, 0x00); // Cut

  return Buffer.from(new Uint8Array(buf));
}`;

// We will replace the entire function buildEscPos(data) { ... }
const startIdx = code.indexOf('function buildEscPos(data) {');
const endIdx = code.indexOf('function buildPsScript(filePath) {');

if (startIdx !== -1 && endIdx !== -1) {
  code = code.substring(0, startIdx) + newBody + '\n\n' + code.substring(endIdx);
  fs.writeFileSync('kiosk-print-server.js', code);
  console.log("Patched successfully");
} else {
  console.log("Could not find function bounds.");
}
