require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const os = require("os");

const app = express();

app.use(cors());
app.use(express.json());

const isDev = process.env.NODE_ENV !== "production";

function loadSendSmsHandler() {
  const handlerPath = path.resolve(__dirname, "api", "send-sms.js");
  if (isDev) {
    delete require.cache[handlerPath];
  }
  return require(handlerPath);
}

app.post("/api/send-sms", async (req, res) => {
  try {
    const sendSmsHandler = loadSendSmsHandler();
    await sendSmsHandler(req, res);
  } catch (e) {
    console.error("Local Server Error:", e);
    res.status(500).json({ error: "Server logic error" });
  }
});

// --- PAYMONGO GCASH INTEGRATION ---
const paymentStatuses = {}; // In-memory store for webhook updates

// POST /api/create-payment
app.post("/api/create-payment", async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    if (!process.env.PAYMONGO_SECRET_KEY) {
      console.error("PAYMONGO_SECRET_KEY is missing. Did you forget to restart the server?");
      return res.status(500).json({ error: "Server Configuration Error: Missing API Key" });
    }

    const authHeader = `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString("base64")}`;
    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      authorization: authHeader
    };

    // 1. Create Payment Intent
    const piRes = await fetch("https://api.paymongo.com/v1/payment_intents", {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: {
          attributes: {
            amount: amount,
            payment_method_allowed: ["qrph"],
            currency: "PHP",
            description: `Order ${orderId}`
          }
        }
      })
    });

    const piData = await piRes.json();
    if (!piRes.ok) return res.status(400).json({ error: piData.errors });
    const piId = piData.data.id;

    // 2. Create Payment Method
    const pmRes = await fetch("https://api.paymongo.com/v1/payment_methods", {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: {
          attributes: { type: "qrph" }
        }
      })
    });

    const pmData = await pmRes.json();
    if (!pmRes.ok) return res.status(400).json({ error: pmData.errors });
    const pmId = pmData.data.id;

    // 3. Attach Payment Method to Payment Intent
    const attachRes = await fetch(`https://api.paymongo.com/v1/payment_intents/${piId}/attach`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: {
          attributes: { payment_method: pmId }
        }
      })
    });

    const attachData = await attachRes.json();
    if (!attachRes.ok) return res.status(400).json({ error: attachData.errors });

    // 4. Extract QR image url and return
    const qrImageUrl = attachData.data.attributes.next_action?.code?.image_url;
    if (!qrImageUrl) {
      return res.status(500).json({ error: "No QR code returned from PayMongo" });
    }

    paymentStatuses[piId] = "unpaid";
    res.json({ paymentId: piId, qrImageUrl });

  } catch (error) {
    console.error("Error creating payment:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── ESC/POS builder (used by /api/print-receipt) ─────────────────────────────
const PRINTER_NAME = process.env.PRINTER_NAME || "TX 80 Thermal";

function buildEscPosReceipt({ orderId, customerName, items, total }) {
  const buf = [];
  const wr = (...b) => buf.push(...b);
  const ws = (s) => { for (const c of String(s || "")) buf.push(c.charCodeAt(0)); };
  const wc = (s) => {
    const str = String(s || "").slice(0, 48);
    const pad = Math.max(0, Math.floor((48 - str.length) / 2));
    ws(" ".repeat(pad) + str + "\n");
  };

  wr(0x1b, 0x40);          // Init printer
  wr(0x1b, 0x61, 0x01);    // Center align

  // ASCII logo header
  wr(0x1b, 0x21, 0x30);    // Double size
  wc("RANAW");
  wr(0x1b, 0x21, 0x00);    // Normal size
  wc("PICKLEBALL COURT");
  wc("Food Court");
  ws("================================\n");

  wr(0x1b, 0x21, 0x08);    // Bold
  wc("GCash Payment Receipt");
  wr(0x1b, 0x21, 0x00);    // Normal
  ws("--------------------------------\n");

  wr(0x1b, 0x61, 0x00);    // Left align
  ws(`Order   : ${orderId}\n`);
  ws(`Customer: ${customerName || "Guest"}\n`);
  ws(`Date    : ${new Date().toLocaleString("en-PH")}\n`);
  ws("--------------------------------\n");

  let subtotal = 0;
  for (const it of items || []) {
    const lineTotal = Number(it.lineTotal) || 0;
    subtotal += lineTotal;
    const left = `${it.quantity}x ${String(it.name).slice(0, 28)}`;
    const right = `P${lineTotal.toFixed(2)}`;
    const gap = Math.max(1, 40 - left.length - right.length);
    ws(left + " ".repeat(gap) + right + "\n");
  }

  ws("================================\n");
  wr(0x1b, 0x61, 0x01);    // Center
  wr(0x1b, 0x21, 0x30);    // Double size
  ws(`TOTAL: P${Number(total || subtotal).toFixed(2)}\n`);
  wr(0x1b, 0x21, 0x00);    // Normal
  ws("--------------------------------\n");
  wr(0x1b, 0x21, 0x08);    // Bold
  ws("Payment: GCash  |  ** PAID **\n");
  wr(0x1b, 0x21, 0x00);
  ws("\n");
  ws("Thank you for your order!\n");
  ws("Have a great game!\n");
  ws("\n\n\n\n");
  wr(0x1d, 0x56, 0x41, 0x00); // Full cut

  return Buffer.from(new Uint8Array(buf));
}

function buildPsScript(filePath) {
  const escaped = filePath.replace(/\\/g, "\\\\");
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
        bool ok = false; IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "Kiosk Receipt"; di.pDataType = "RAW";
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
$bytes = [System.IO.File]::ReadAllBytes('${escaped}')
[RawPrint]::Send("${PRINTER_NAME}", $bytes)
`;
}

// POST /api/print-receipt
// Accepts JSON receipt data, builds ESC/POS bytes, and prints via Windows Spooler — no browser popup.
app.post("/api/print-receipt", (req, res) => {
  try {
    const { orderId, customerName, items, total } = req.body;
    if (!items) {
      return res.status(400).json({ error: "Missing receipt data" });
    }

    const receiptBuf = buildEscPosReceipt({ orderId, customerName, items, total });
    const tmpBin = path.join(os.tmpdir(), "receipt.bin");
    const tmpPs  = path.join(os.tmpdir(), "print-receipt.ps1");
    fs.writeFileSync(tmpBin, receiptBuf);
    fs.writeFileSync(tmpPs, buildPsScript(tmpBin));

    console.log(`Printing receipt to "${PRINTER_NAME}"...`);
    exec(`powershell -ExecutionPolicy Bypass -File "${tmpPs}"`, (err, stdout) => {
      if (err || (stdout && stdout.trim() === "False")) {
        console.error("Print failed:", err || stdout);
        return res.status(500).json({ error: "Print failed. Check printer name in .env PRINTER_NAME." });
      }
      console.log(`✅ Receipt printed to "${PRINTER_NAME}"`);
      return res.json({ success: true });
    });
  } catch (error) {
    console.error("Print-receipt error:", error);
    res.status(500).json({ error: "Internal server error during printing" });
  }
});

// GET /api/check-status/:paymentId
app.get("/api/check-status/:paymentId", async (req, res) => {
  const { paymentId } = req.params;

  if (paymentStatuses[paymentId] === "paid") {
    return res.json({ status: "paid" });
  }

  try {
    const response = await fetch(`https://api.paymongo.com/v1/payment_intents/${paymentId}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString("base64")}`
      }
    });

    const data = await response.json();
    if (response.ok && data.data) {
      if (data.data.attributes.status === "succeeded") {
        paymentStatuses[paymentId] = "paid";
        return res.json({ status: "paid" });
      }
    }
  } catch (error) {
    console.error("Error polling status:", error);
  }

  res.json({ status: "unpaid" });
});

// POST /api/webhooks/paymongo
app.post("/api/webhooks/paymongo", async (req, res) => {
  try {
    const event = req.body;

    // Check for payment.paid event for Payment Intents
    if (event.data && event.data.attributes && event.data.attributes.type === "payment.paid") {
      const paymentId = event.data.attributes.data.attributes.payment_intent_id;
      if (paymentId) {
        console.log(`Payment confirmed via webhook for: ${paymentId}`);
        paymentStatuses[paymentId] = "paid";
      }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).send("Error");
  }
});

const PORT = 3001;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Local API Server running on http://127.0.0.1:${PORT}`);
  if (isDev) {
    console.log("SMS API reloads on each request (development mode).");
  }
  const mask = process.env.M360_SHORTCODE_MASK || process.env.M360_SENDER_ID || "";
  if (!String(mask).trim()) {
    console.warn(
      "WARNING: M360_SHORTCODE_MASK is not set — SMS will fail until you add your m360 sender ID to .env"
    );
  }
});
