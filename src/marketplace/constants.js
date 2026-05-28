/** @typedef {'food'|'drinks'|'snacks'|'merchandise'} StoreCategory */
/** @typedef {'active'|'closed'} StoreStatus */

export const STORE_CATEGORIES = [
  { id: "food", label: "Food" },
  { id: "drinks", label: "Drinks" },
  { id: "snacks", label: "Snacks" },
  { id: "merchandise", label: "Merchandise" },
];

export const STORE_STATUS = {
  ACTIVE: "active",
  CLOSED: "closed",
};

export const CUSTOMER_TYPE = {
  GUEST: "guest",
  REGISTERED: "registered",
};

export const PAYMENT_MODE = {
  PAY_NOW: "payNow",
  PAY_LATER: "payLater",
};

export const PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  BILLED: "billed",
  UNPAID: "unpaid", // legacy
};

export const DISPATCH_STATUS = {
  BLOCKED: "blocked",
  DISPATCHED: "dispatched",
};

export const ORDER_SOURCE = {
  FOODCOURT: "foodcourt",
  COURT_QR: "court_qr",
  WALK_IN: "walk_in",
};

export const VENDOR_PAYMENT_BADGE = {
  PAID: "PAID",
  ACCOUNT_CHARGE: "ACCOUNT_CHARGE",
  BLOCKED: "BLOCKED",
};

export const VENDOR_ORDER_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  PREPARING: "preparing",
  READY: "ready_for_pickup",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

export const VENDOR_ORDER_STATUS_LABELS = {
  pending: "Pending",
  accepted: "Accepted",
  preparing: "Preparing",
  ready_for_pickup: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const CUSTOMER_ORDER_STATUS = {
  AWAITING_PAYMENT: "awaiting_payment",
  PENDING_PAYMENT: "pending_payment", // legacy alias
  PAID: "paid",
  BILLED: "billed",
  CANCELLED: "cancelled",
  REJECTED: "rejected",
};

export const PAYOUT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
};

export const PLATFORM_SERVICE_FEE_RATE = 0.02;

export const FOODCOURT_PATH = "/foodcourt";

export function categoryLabel(id) {
  return STORE_CATEGORIES.find((c) => c.id === id)?.label || id || "—";
}

export function customerTypeLabel(t) {
  return t === CUSTOMER_TYPE.REGISTERED ? "Registered" : "Guest";
}

export function paymentModeLabel(m) {
  return m === PAYMENT_MODE.PAY_LATER ? "Pay Later" : "Pay Now";
}
