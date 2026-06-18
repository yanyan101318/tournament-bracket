const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

console.log("Generating test ESC/POS receipt...");

const buffer = [];
const write = (...bytes) => buffer.push(...bytes);
const writeString = (str) => {
  for (let i = 0; i < str.length; i++) buffer.push(str.charCodeAt(i));
};

// 1. Initialize Printer (ESC @)
write(0x1b, 0x40);

// 2. Align Center (ESC a 1)
write(0x1b, 0x61, 0x01);

// 3. Print Header
writeString("================================\n");
write(0x1b, 0x21, 0x30); // Double height & width
writeString("HARDWARE TEST\n");
write(0x1b, 0x21, 0x00); // Normal text
writeString("================================\n");
write(0x1b, 0x61, 0x00); // Align Left (ESC a 0)
writeString("If you are reading this, the\n");
writeString("printer is configured correctly!\n");
writeString("--------------------------------\n");
writeString("\n\n\n\n");
// 4. Feed paper & Cut (GS V A 0)
write(0x1d, 0x56, 0x41, 0x00);

const testBuffer = Buffer.from(new Uint8Array(buffer));
const tmpPath = path.join(os.tmpdir(), "test-receipt.bin");
fs.writeFileSync(tmpPath, testBuffer);

console.log("Saved test receipt to:", tmpPath);
console.log("Sending to \\\\127.0.0.1\\TX80...");

exec(`copy /b "${tmpPath}" "\\\\127.0.0.1\\TX80"`, (err1) => {
  if (err1) {
    console.log("Failed to send via shared name TX80, trying USB001 directly...");
    exec(`copy /b "${tmpPath}" USB001`, (err2) => {
      if (err2) {
        console.error("\n❌ ERROR: Printer failed to respond!");
        console.error("Please make sure you shared the printer as 'TX80' in your Windows Printer properties!");
      } else {
        console.log("\n✅ SUCCESS: Printed directly via USB001!");
      }
    });
  } else {
    console.log("\n✅ SUCCESS: Printed via \\\\127.0.0.1\\TX80!");
  }
});
