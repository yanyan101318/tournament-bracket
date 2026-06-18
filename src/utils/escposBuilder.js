/**
 * escposBuilder.js
 * Generates raw ESC/POS byte commands for thermal printers.
 */

export function buildEscPosReceipt(orderData) {
  const { orderId, customerName, items, total } = orderData;
  const buffer = [];

  // Helper to add bytes
  const write = (...bytes) => buffer.push(...bytes);
  const writeString = (str) => {
    for (let i = 0; i < str.length; i++) {
      buffer.push(str.charCodeAt(i));
    }
  };

  // 1. Initialize Printer (ESC @)
  write(0x1b, 0x40);

  // 2. Align Center (ESC a 1)
  write(0x1b, 0x61, 0x01);

  // 3. Print Header
  writeString("================================\n");
  write(0x1b, 0x21, 0x30); // Double height & width
  writeString("RANAW FOOD COURT\n");
  write(0x1b, 0x21, 0x00); // Normal text
  writeString("================================\n");

  // 4. Order Info
  write(0x1b, 0x61, 0x00); // Align Left (ESC a 0)
  writeString(`Order ID: ${orderId}\n`);
  writeString(`Date: ${new Date().toLocaleString()}\n`);
  writeString(`Customer: ${customerName}\n`);
  writeString(`Payment: GCASH\n`);
  writeString("--------------------------------\n");

  // 5. Items
  items.forEach(it => {
    const line = `${it.quantity}x ${it.name}`;
    const priceStr = `PHP ${it.lineTotal.toFixed(2)}`;
    
    // Pad to 32 characters (standard 80mm width text)
    const spacesCount = Math.max(0, 32 - line.length - priceStr.length);
    const spaces = " ".repeat(spacesCount);
    
    writeString(`${line}${spaces}${priceStr}\n`);
  });

  writeString("--------------------------------\n");

  // 6. Total
  write(0x1b, 0x61, 0x02); // Align Right
  write(0x1b, 0x21, 0x10); // Double height
  writeString(`TOTAL: PHP ${total.toFixed(2)}\n`);
  write(0x1b, 0x21, 0x00); // Normal text
  writeString("--------------------------------\n");

  // 7. Footer
  write(0x1b, 0x61, 0x01); // Align Center
  writeString("*** PAID ***\n");
  writeString("Please wait for your number\n");
  writeString("to be called at the counter.\n");
  writeString("Thank you!\n");
  
  // 8. Feed paper & Cut (GS V A 0)
  writeString("\n\n\n\n");
  write(0x1d, 0x56, 0x41, 0x00);

  return new Uint8Array(buffer);
}
