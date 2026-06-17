import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BRAND_MOTTO, BRAND_NAME, LOGO_PATH } from "../lib/brand";

export default function ReceiptPrint({ booking, receiptId, printedBy, onAfterPrint }) {
  const [printTriggered, setPrintTriggered] = useState(false);

  useEffect(() => {
    // Trigger print automatically when component mounts
    if (!printTriggered) {
      setPrintTriggered(true);
      document.title = `${BRAND_NAME} RECEIPT`;
      // Small timeout to ensure DOM is fully updated
      setTimeout(() => {
        window.print();
        if (onAfterPrint) onAfterPrint();
      }, 300);
    }
  }, [printTriggered, onAfterPrint]);

  if (!booking) return null;

  const total = Number(booking.totalAmount) || 0;
  const paid = Number(booking.amountPaid) || 0;
  const remaining = Math.max(0, total - paid);
  const hourly = Number(booking.hourlyRate) || 0;
  const discount = Number(booking.discountAmount) || 0;
  
  const statusColors = {
    "paid": "#16a34a", // green-600
    "approved": "#16a34a",
    "partial": "#ca8a04", // yellow-600
    "pending": "#ca8a04",
    "unpaid": "#dc2626", // red-600
    "rejected": "#dc2626",
    "cancelled": "#dc2626",
  };
  
  const pStatus = (booking.customerPaymentStatus || "PENDING").toLowerCase();
  const statusColor = statusColors[pStatus] || "#000";

  const Row = ({ label, value, bold }) => (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", fontWeight: bold ? "bold" : "normal" }}>
      <span style={{ color: "#555" }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );

  const Divider = () => (
    <div style={{ borderBottom: "1px dashed #000", margin: "12px 0" }}></div>
  );

  const receiptContent = (
    <div id="thermal-receipt" style={{
      width: "100%", // Fill the thermal paper width automatically
      padding: "2mm",
      background: "#fff",
      color: "#000",
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: "14px",
      lineHeight: "1.4",
      boxSizing: "border-box",
      margin: "0",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "15px" }}>
        <img
          src={LOGO_PATH}
          alt={BRAND_NAME}
          style={{
            display: "block",
            margin: "0 auto 6px",
            maxWidth: "100%",
            width: "220px",
            height: "auto",
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          }}
        />
        <div style={{ fontSize: "12px", fontWeight: "bold", textTransform: "uppercase", marginBottom: "2px" }}>Official Booking Receipt</div>
        <div style={{ fontSize: "11px", fontStyle: "italic", color: "#555" }}>{BRAND_MOTTO}</div>
      </div>

      <Divider />

      {/* Info */}
      <div style={{ marginBottom: "15px" }}>
        <Row label="Receipt No:" value={<strong>{receiptId}</strong>} />
        <Row label="Trans. Date:" value={`${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`} />
        <Row label="Staff:" value={printedBy || "Admin"} />
      </div>

      <Divider />

      {/* Customer Info */}
      <div style={{ marginBottom: "15px" }}>
        <div style={{ fontWeight: "bold", textTransform: "uppercase", marginBottom: "8px", textAlign: "center" }}>Customer Info</div>
        <Row label="Name:" value={<strong>{booking.playerName || "Walk-in Customer"}</strong>} />
        {booking.contactNumber && (
          <Row label="Contact:" value={booking.contactNumber} />
        )}
      </div>

      <Divider />

      {/* Booking Details */}
      <div style={{ marginBottom: "15px" }}>
        <div style={{ fontWeight: "bold", textTransform: "uppercase", marginBottom: "8px", textAlign: "center" }}>Booking Details</div>
        <Row label="Booking ID:" value={booking.id} />
        <Row label="Court:" value={<strong>{booking.courtName || booking.courtId}</strong>} />
        <Row label="Date:" value={booking.date} />
        <Row label="Time Slot:" value={booking.timeSlot} />
        <Row label="Duration:" value={`${booking.duration} hr(s)`} />
      </div>

      <Divider />

      {/* Payment Details */}
      <div style={{ marginBottom: "15px" }}>
        <div style={{ fontWeight: "bold", textTransform: "uppercase", marginBottom: "8px", textAlign: "center" }}>Payment Summary</div>
        <Row label="Rate/Hr:" value={`₱${hourly.toFixed(2)}`} />
        {discount > 0 && <Row label="Discount:" value={`- ₱${discount.toFixed(2)}`} />}
        
        <div style={{ borderTop: "1px solid #000", marginTop: "8px", paddingTop: "8px" }}>
          <Row label="TOTAL:" value={`₱${total.toFixed(2)}`} bold />
          <Row label="PAID:" value={`₱${paid.toFixed(2)}`} bold />
          <Row label="BALANCE:" value={`₱${remaining.toFixed(2)}`} bold />
        </div>
        
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12px", alignItems: "center" }}>
          <span style={{ color: "#555", fontWeight: "bold" }}>STATUS:</span>
          <span style={{ 
            textTransform: "uppercase", 
            fontWeight: "bold",
            color: "#fff",
            backgroundColor: statusColor,
            padding: "4px 8px",
            borderRadius: "4px",
            fontSize: "12px",
            letterSpacing: "1px"
          }}>
            {booking.customerPaymentStatus || "PENDING"}
          </span>
        </div>
      </div>

      <Divider />

      {/* Footer */}
      <div style={{ textAlign: "center", marginTop: "20px" }}>
        <img
          src={LOGO_PATH}
          alt={BRAND_NAME}
          style={{
            display: "block",
            margin: "0 auto 6px",
            maxWidth: "100%",
            width: "180px",
            height: "auto",
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          }}
        />
        <div style={{ fontSize: "11px", marginBottom: "12px" }}>Your premier destination for professional pickleball court reservations.</div>
        
        <div style={{ fontSize: "12px", lineHeight: "1.6", color: "#333" }}>
          <div>Phone: [Insert contact]</div>
          <div>Email: [Insert email]</div>
          <div>Location: [Insert address]</div>
        </div>
        <div style={{ marginTop: "15px", fontWeight: "bold" }}>THANK YOU!</div>
      </div>
    </div>
  );

  return createPortal(
    <div id="receipt-print-wrapper">
      {receiptContent}
    </div>,
    document.body
  );
}
