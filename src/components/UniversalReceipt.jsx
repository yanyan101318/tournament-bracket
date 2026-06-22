import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LOGO_PATH } from "../lib/brand";
import "./UniversalReceipt.css";

export default function UniversalReceipt({
  receiptId,
  date,
  customerName,
  customerContact,
  items = [], // Array of { description, qty, unitPrice, total }
  subtotal,
  discount,
  total,
  paymentMethod,
  onAfterPrint,
  autoPrint = true,
  isPreview = false // Renders inline instead of portal for screen preview
}) {
  const [printTriggered, setPrintTriggered] = useState(false);

  useEffect(() => {
    if (autoPrint && !isPreview && !printTriggered) {
      setPrintTriggered(true);
      const originalTitle = document.title;
      document.title = "RECEIPT"; // Keep print filename clean
      
      // Allow DOM to update before triggering print
      const timer = setTimeout(() => {
        window.print();
        document.title = originalTitle;
        if (onAfterPrint) onAfterPrint();
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [autoPrint, isPreview, printTriggered, onAfterPrint]);

  const content = (
    <div 
      className={isPreview ? "universal-receipt-preview" : ""} 
      id={!isPreview ? "universal-receipt-print-area" : undefined}
    >
      {/* Header */}
      <div className="ur-text-center ur-mb-md">
        <img
          src={LOGO_PATH}
          alt="Logo"
          style={{
            display: "block",
            margin: "0 auto 6px",
            width: "50mm",
            height: "auto",
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          }}
        />
        <div className="ur-bold ur-text-xl ur-mb-sm">RANAW PICKLEBALL COURT</div>
        <div className="ur-mb-sm">123 Sports Avenue, Marawi City, RC 90210</div>
        <div>+1 (555) 123-4567 | www.ranawpickleball.com</div>
      </div>

      <div className="ur-divider-solid"></div>

      {/* Details (Split Layout) */}
      <div style={{ display: "flex", justifyContent: "space-between" }} className="ur-mb-md">
        <div>{date || new Date().toLocaleString()}</div>
        <div className="ur-bold">{receiptId}</div>
      </div>

      {/* Customer Info (Conditional) */}
      {(customerName || customerContact) && (
        <div className="ur-mb-md">
          <div className="ur-bold ur-mb-sm">CUSTOMER INFO:</div>
          {customerName && <div>{customerName}</div>}
          {customerContact && <div>{customerContact}</div>}
        </div>
      )}

      {/* Items Table */}
      <table className="ur-table">
        <thead>
          <tr>
            <th style={{ width: "40%" }}>ITEM</th>
            <th style={{ width: "15%" }}>QTY</th>
            <th style={{ width: "22.5%" }}>PRICE</th>
            <th style={{ width: "22.5%" }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colSpan="4"><div className="ur-divider"></div></td></tr>
          {items.map((item, idx) => (
            <tr key={idx}>
              <td>{item.description}</td>
              <td>{item.qty}</td>
              <td>{Number(item.unitPrice).toFixed(2)}</td>
              <td>{Number(item.total).toFixed(2)}</td>
            </tr>
          ))}
          <tr><td colSpan="4"><div className="ur-divider"></div></td></tr>
        </tbody>
      </table>

      {/* Payment Summary */}
      <div style={{ marginLeft: "auto", width: "75%" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }} className="ur-mb-sm">
          <span>Subtotal:</span>
          <span>{Number(subtotal).toFixed(2)}</span>
        </div>
        {discount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between" }} className="ur-mb-sm">
            <span>Discount:</span>
            <span>-{Number(discount).toFixed(2)}</span>
          </div>
        )}
        <div className="ur-divider-solid"></div>
        <div style={{ display: "flex", justifyContent: "space-between" }} className="ur-bold ur-text-lg">
          <span>TOTAL:</span>
          <span>{Number(total).toFixed(2)}</span>
        </div>
      </div>

      {/* Payment Method */}
      {paymentMethod && (
        <div className="ur-mb-md" style={{ marginTop: "12px" }}>
          <span className="ur-bold">Payment Method: </span>
          <span>{paymentMethod}</span>
        </div>
      )}

      <div className="ur-divider-double"></div>

      {/* Footer */}
      <div className="ur-text-center" style={{ marginTop: "16px" }}>
        <div className="ur-mb-sm">Thank you for playing at Ranaw!</div>
        <div>See you on the court! 🏓</div>
      </div>
    </div>
  );

  // If preview mode, just return the content inline
  if (isPreview) {
    return content;
  }

  // Otherwise, use a portal to attach to body for printing
  return createPortal(
    <div className="universal-receipt-wrapper">
      {content}
    </div>,
    document.body
  );
}
