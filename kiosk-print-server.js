/**
 * kiosk-print-server.js
 * Run this on the KIOSK DEVICE (not the laptop).
 * It listens on http://localhost:3002 and prints receipts
 * directly to the thermal printer via Windows Spooler — no browser popup.
 *
 * HOW TO START:
 *   node kiosk-print-server.js
 *
 * Keep this running in the background while the kiosk is in use.
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");

const PORT = 3002;
// Change "POS-58" below to the exact printer name shown in
// Windows Settings > Printers & scanners if it's different.
const PRINTER_NAME = "TX 80 Thermal";

// ── PowerShell Raw-Print helper (writes directly to Windows Spooler) ──────────
function buildPsScript(filePath) {
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string n, out IntPtr h, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr h, Int32 l, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA d);
    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr h, IntPtr p, Int32 c, out Int32 w);
    public static bool Send(string name, byte[] bytes) {
        IntPtr ptr = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, ptr, bytes.Length);
        bool ok = false;
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "Kiosk Receipt";
        di.pDataType = "RAW";
        if (OpenPrinter(name, out hPrinter, IntPtr.Zero)) {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    Int32 written = 0;
                    ok = WritePrinter(hPrinter, ptr, bytes.Length, out written);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        Marshal.FreeCoTaskMem(ptr);
        return ok;
    }
}
"@
$bytes = [System.IO.File]::ReadAllBytes('${filePath.replace(/\\/g, "\\\\")}')
[RawPrint]::Send("${PRINTER_NAME}", $bytes)
`;
}

// ── ESC/POS receipt builder ───────────────────────────────────────────────────
function buildEscPos({ orderId, customerName, items, total }) {
  const buf = [];
  const wr = (...b) => buf.push(...b);
  const ws = (s) => { for (const c of String(s)) buf.push(c.charCodeAt(0)); };
  const wl = (s) => ws((s || "").padEnd(48).slice(0, 48) + "\n");
  const wc = (s) => {
    const str = String(s || "").slice(0, 48);
    const pad = Math.max(0, Math.floor((48 - str.length) / 2));
    ws(" ".repeat(pad) + str + "\n");
  };

  wr(0x1b, 0x40);          // Init
  wr(0x1b, 0x61, 0x01);    // Center
  wr(0x1b, 0x21, 0x30);    // Double size
  ws("RANAW FOOD COURT\n");
  wr(0x1b, 0x21, 0x00);    // Normal
  wc("GCash Payment Receipt");
  ws("--------------------------------\n");
  wr(0x1b, 0x61, 0x00);    // Left
  ws(`Order ID: ${orderId}\n`);
  ws(`Customer: ${customerName || "Guest"}\n`);
  ws(`Date    : ${new Date().toLocaleString("en-PH")}\n`);
  ws("--------------------------------\n");

  let subtotal = 0;
  for (const it of items || []) {
    const lineTotal = Number(it.lineTotal) || 0;
    subtotal += lineTotal;
    const left = `${it.quantity}x ${it.name}`.slice(0, 32);
    const right = `P${lineTotal.toFixed(2)}`;
    const gap = Math.max(1, 40 - left.length - right.length);
    ws(left + " ".repeat(gap) + right + "\n");
  }

  ws("--------------------------------\n");
  wr(0x1b, 0x21, 0x20);    // Bold
  const totalStr = `TOTAL: P${Number(total || subtotal).toFixed(2)}`;
  wc(totalStr);
  wr(0x1b, 0x21, 0x00);    // Normal
  ws("--------------------------------\n");
  wr(0x1b, 0x61, 0x01);    // Center
  ws("Payment: GCash\n");
  ws("** PAID **\n");
  ws("\n");
  ws("Thank you for your order!\n");
  ws("\n\n\n\n");
  wr(0x1d, 0x56, 0x41, 0x00); // Cut

  return Buffer.from(new Uint8Array(buf));
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // Allow cross-origin requests from the kiosk browser
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/print") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const receiptBuf = buildEscPos(data);

        const tmpBin = path.join(os.tmpdir(), "kiosk-receipt.bin");
        const tmpPs = path.join(os.tmpdir(), "kiosk-print.ps1");
        fs.writeFileSync(tmpBin, receiptBuf);
        fs.writeFileSync(tmpPs, buildPsScript(tmpBin));

        exec(`powershell -ExecutionPolicy Bypass -File "${tmpPs}"`, (err, stdout) => {
          if (err || (stdout && stdout.includes("False"))) {
            console.error("[kiosk-print-server] Print FAILED:", err || stdout);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Print failed" }));
          } else {
            console.log("[kiosk-print-server] ✅ Receipt printed to", PRINTER_NAME);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          }
        });
      } catch (e) {
        console.error("[kiosk-print-server] Parse error:", e);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bad request" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[kiosk-print-server] Running on http://127.0.0.1:${PORT}`);
  console.log(`[kiosk-print-server] Printer target: "${PRINTER_NAME}"`);
  console.log(`[kiosk-print-server] Waiting for print jobs...`);
});
