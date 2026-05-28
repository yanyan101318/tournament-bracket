import {
  CUSTOMER_TYPE,
  PAYMENT_MODE,
  PAYMENT_STATUS,
  DISPATCH_STATUS,
  VENDOR_PAYMENT_BADGE,
  CUSTOMER_ORDER_STATUS,
} from "../../marketplace/constants";

/** Guest orders must never reach vendors before payment. */
export function shouldDispatchToVendorsOnCreate({ customerType, paymentMode }) {
  return customerType === CUSTOMER_TYPE.REGISTERED && paymentMode === PAYMENT_MODE.PAY_LATER;
}

export function vendorPaymentBadgeForOrder(order) {
  if (order.dispatchStatus !== DISPATCH_STATUS.DISPATCHED) {
    return VENDOR_PAYMENT_BADGE.BLOCKED;
  }
  if (order.paymentMode === PAYMENT_MODE.PAY_LATER && order.customerType === CUSTOMER_TYPE.REGISTERED) {
    return VENDOR_PAYMENT_BADGE.ACCOUNT_CHARGE;
  }
  if (order.paymentStatus === PAYMENT_STATUS.PAID) {
    return VENDOR_PAYMENT_BADGE.PAID;
  }
  return VENDOR_PAYMENT_BADGE.BLOCKED;
}

export function vendorCanSeeOrder(order) {
  return order.dispatchStatus === DISPATCH_STATUS.DISPATCHED;
}

export function vendorCanSeeVendorOrder(vendorOrder) {
  if (vendorOrder.visibleToVendor === false) return false;
  const badge = vendorOrder.paymentBadge || VENDOR_PAYMENT_BADGE.BLOCKED;
  return badge !== VENDOR_PAYMENT_BADGE.BLOCKED;
}

export function initialOrderStatus({ customerType, paymentMode }) {
  if (shouldDispatchToVendorsOnCreate({ customerType, paymentMode })) {
    return {
      status: CUSTOMER_ORDER_STATUS.BILLED,
      paymentStatus: PAYMENT_STATUS.BILLED,
      dispatchStatus: DISPATCH_STATUS.DISPATCHED,
    };
  }
  return {
    status: CUSTOMER_ORDER_STATUS.AWAITING_PAYMENT,
    paymentStatus: PAYMENT_STATUS.PENDING,
    dispatchStatus: DISPATCH_STATUS.BLOCKED,
  };
}

export function afterPosPaymentStatus() {
  return {
    status: CUSTOMER_ORDER_STATUS.PAID,
    paymentStatus: PAYMENT_STATUS.PAID,
    dispatchStatus: DISPATCH_STATUS.DISPATCHED,
  };
}
