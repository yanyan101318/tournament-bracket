import {
  collection,
  doc,
  updateDoc,
  writeBatch,
  getDocs,
  query,
  orderBy,
  onSnapshot,
  increment,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebase";
import { roundMoney } from "../../lib/bookingMoney";
import { vendorOrdersCollection } from "./storesService";
import { storeProductsCollection } from "./storesService";
import {
  CUSTOMER_ORDER_STATUS,
  CUSTOMER_TYPE,
  PAYMENT_MODE,
  PAYMENT_STATUS,
  DISPATCH_STATUS,
  ORDER_SOURCE,
  VENDOR_ORDER_STATUS,
  PLATFORM_SERVICE_FEE_RATE,
} from "../../marketplace/constants";
import {
  shouldDispatchToVendorsOnCreate,
  initialOrderStatus,
  afterPosPaymentStatus,
  vendorPaymentBadgeForOrder,
} from "./orderEngine";
import { addToCustomerBalance } from "./customerBalanceService";

const CUSTOMER_ORDERS = "customerOrders";

export function customerOrdersCollection() {
  return collection(db, CUSTOMER_ORDERS);
}

function buildStoreBreakdown(storeGroups, serviceFeeRate) {
  const storeBreakdown = [];
  let subtotal = 0;
  for (const group of Object.values(storeGroups)) {
    const storeSubtotal = roundMoney(
      group.items.reduce((s, it) => s + roundMoney(it.lineTotal), 0)
    );
    subtotal = roundMoney(subtotal + storeSubtotal);
    storeBreakdown.push({
      storeId: group.storeId,
      storeName: group.storeName,
      items: group.items,
      subtotal: storeSubtotal,
    });
  }
  const fee = roundMoney(subtotal * serviceFeeRate);
  const grandTotal = roundMoney(subtotal + fee);
  return { storeBreakdown, subtotal, serviceFee: fee, grandTotal };
}

function vendorOrderPayload({
  customerOrderId,
  block,
  orderMeta,
  paymentBadge,
  visibleToVendor,
}) {
  return {
    customerOrderId,
    storeId: block.storeId,
    storeName: block.storeName,
    bookingId: orderMeta.bookingId || null,
    courtId: orderMeta.courtId || null,
    courtName: orderMeta.courtName || null,
    customerName: orderMeta.customerName,
    customerType: orderMeta.customerType,
    paymentMode: orderMeta.paymentMode,
    items: block.items,
    subtotal: block.subtotal,
    specialNotes: block.items.map((i) => i.notes).filter(Boolean).join("; ") || "",
    status: VENDOR_ORDER_STATUS.PENDING,
    paymentStatus: orderMeta.paymentStatus,
    paymentBadge,
    visibleToVendor,
    dispatchStatus: orderMeta.dispatchStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/** Dispatch vendor sub-orders for a customer order (after payment or pay-later). */
export async function dispatchVendorOrdersForCustomerOrder(customerOrder) {
  const batch = writeBatch(db);
  const vendorOrderIds = [];
  const badge = vendorPaymentBadgeForOrder(customerOrder);

  for (const block of customerOrder.storeBreakdown || []) {
    const vendorOrderRef = doc(vendorOrdersCollection(block.storeId));
    vendorOrderIds.push({ storeId: block.storeId, vendorOrderId: vendorOrderRef.id });
    batch.set(
      vendorOrderRef,
      vendorOrderPayload({
        customerOrderId: customerOrder.id,
        block,
        orderMeta: customerOrder,
        paymentBadge: badge,
        visibleToVendor: true,
      })
    );
  }

  batch.update(doc(db, CUSTOMER_ORDERS, customerOrder.id), {
    vendorOrderIds,
    dispatchStatus: DISPATCH_STATUS.DISPATCHED,
    dispatchedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  return vendorOrderIds;
}

/**
 * Central food court order creation with guest / registered + payNow / payLater rules.
 */
export async function createFoodCourtOrder(params) {
  const {
    storeGroups,
    customerType = CUSTOMER_TYPE.GUEST,
    paymentMode = PAYMENT_MODE.PAY_NOW,
    customerName,
    guestPhone = null,
    userId = null,
    userEmail = null,
    bookingId = null,
    courtId = null,
    courtName = null,
    orderSource = ORDER_SOURCE.FOODCOURT,
    serviceFeeRate = PLATFORM_SERVICE_FEE_RATE,
  } = params;

  if (customerType === CUSTOMER_TYPE.GUEST && paymentMode === PAYMENT_MODE.PAY_LATER) {
    throw new Error("Guests must pay at the counter before orders are sent to vendors.");
  }

  const { storeBreakdown, subtotal, serviceFee, grandTotal } = buildStoreBreakdown(
    storeGroups,
    serviceFeeRate
  );

  const statusFields = initialOrderStatus({ customerType, paymentMode });
  const dispatchNow = shouldDispatchToVendorsOnCreate({ customerType, paymentMode });

  const batch = writeBatch(db);
  const customerOrderRef = doc(customerOrdersCollection());
  const vendorOrderIds = [];

  const orderDoc = {
    customerType,
    paymentMode,
    customerName: customerName || "Guest",
    guestPhone,
    userId,
    userEmail,
    bookingId,
    courtId,
    courtName,
    orderSource,
    storeBreakdown,
    subtotal,
    serviceFee,
    grandTotal,
    ...statusFields,
    vendorOrderIds: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (dispatchNow) {
    const badge = vendorPaymentBadgeForOrder({ ...orderDoc, dispatchStatus: DISPATCH_STATUS.DISPATCHED });
    for (const block of storeBreakdown) {
      const vendorOrderRef = doc(vendorOrdersCollection(block.storeId));
      vendorOrderIds.push({ storeId: block.storeId, vendorOrderId: vendorOrderRef.id });
      batch.set(
        vendorOrderRef,
        vendorOrderPayload({
          customerOrderId: customerOrderRef.id,
          block,
          orderMeta: { ...orderDoc, paymentStatus: statusFields.paymentStatus, dispatchStatus: DISPATCH_STATUS.DISPATCHED },
          paymentBadge: badge,
          visibleToVendor: true,
        })
      );
    }
    orderDoc.vendorOrderIds = vendorOrderIds;
  }

  batch.set(customerOrderRef, orderDoc);
  await batch.commit();

  const result = {
    customerOrderId: customerOrderRef.id,
    grandTotal,
    vendorOrderIds,
    ...statusFields,
  };

  if (dispatchNow && userId) {
    await addToCustomerBalance(userId, customerOrderRef.id, grandTotal);
  }

  return result;
}

/** Legacy court-QR marketplace (booking required, pay at counter). */
export async function createMarketplaceCustomerOrder(params) {
  const { bookingId, courtId, courtName, customerName, storeGroups, serviceFee = 0 } = params;
  const rate = serviceFee > 0 ? serviceFee / buildStoreBreakdown(storeGroups, 0).subtotal : PLATFORM_SERVICE_FEE_RATE;
  return createFoodCourtOrder({
    storeGroups,
    customerType: CUSTOMER_TYPE.GUEST,
    paymentMode: PAYMENT_MODE.PAY_NOW,
    customerName,
    bookingId,
    courtId,
    courtName,
    orderSource: ORDER_SOURCE.COURT_QR,
    serviceFeeRate: Number.isFinite(rate) ? rate : PLATFORM_SERVICE_FEE_RATE,
  });
}

export function subscribeMarketplaceOrders(callback) {
  const q = query(customerOrdersCollection(), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error("subscribeMarketplaceOrders", err);
      callback([]);
    }
  );
}

export function subscribePendingCustomerOrders(callback) {
  return subscribeMarketplaceOrders((list) => {
    const pending = list.filter(
      (o) =>
        o.dispatchStatus === DISPATCH_STATUS.BLOCKED &&
        (o.paymentStatus === PAYMENT_STATUS.PENDING ||
          o.status === CUSTOMER_ORDER_STATUS.AWAITING_PAYMENT ||
          o.status === CUSTOMER_ORDER_STATUS.PENDING_PAYMENT)
    );
    callback(pending);
  });
}

export function subscribeCustomerOrder(orderId, callback) {
  return onSnapshot(doc(db, CUSTOMER_ORDERS, orderId), (snap) => {
    if (!snap.exists()) callback(null);
    else callback({ id: snap.id, ...snap.data() });
  });
}

export async function rejectCustomerOrder(orderId) {
  await updateDoc(doc(db, CUSTOMER_ORDERS, orderId), {
    status: CUSTOMER_ORDER_STATUS.REJECTED,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Admin POS payment — marks paid, dispatches to vendors, decrements stock, settlements.
 */
export async function payCustomerOrderAtPos({
  customerOrder,
  paymentMethod,
  cashierName,
  commissionByStore,
}) {
  const batch = writeBatch(db);
  const verificationCode =
    "FC-" + customerOrder.id.substring(0, 6).toUpperCase() + "-" + Math.floor(1000 + Math.random() * 9000);

  const settlements = [];
  let totalCommission = 0;
  let totalVendorNet = 0;

  for (const block of customerOrder.storeBreakdown || []) {
    const rate = Number(commissionByStore?.[block.storeId]) || 0;
    const gross = roundMoney(block.subtotal);
    const commission = roundMoney(gross * (rate / 100));
    const vendorNet = roundMoney(gross - commission);
    totalCommission = roundMoney(totalCommission + commission);
    totalVendorNet = roundMoney(totalVendorNet + vendorNet);
    settlements.push({
      storeId: block.storeId,
      storeName: block.storeName,
      gross,
      commissionRate: rate,
      commission,
      vendorNet,
    });

    for (const item of block.items || []) {
      if (item.productId && item.quantity) {
        batch.update(doc(storeProductsCollection(block.storeId), item.productId), {
          stock: increment(-item.quantity),
        });
      }
    }
  }

  const paidFields = afterPosPaymentStatus();
  const badge = vendorPaymentBadgeForOrder({ ...customerOrder, ...paidFields });

  let vendorOrderIds = customerOrder.vendorOrderIds || [];

  if (customerOrder.dispatchStatus !== DISPATCH_STATUS.DISPATCHED) {
    vendorOrderIds = [];
    for (const block of customerOrder.storeBreakdown || []) {
      const vendorOrderRef = doc(vendorOrdersCollection(block.storeId));
      vendorOrderIds.push({ storeId: block.storeId, vendorOrderId: vendorOrderRef.id });
      batch.set(
        vendorOrderRef,
        {
          ...vendorOrderPayload({
            customerOrderId: customerOrder.id,
            block,
            orderMeta: { ...customerOrder, ...paidFields },
            paymentBadge: badge,
            visibleToVendor: true,
          }),
          paymentStatus: PAYMENT_STATUS.PAID,
          paidAt: serverTimestamp(),
        }
      );
    }
  } else {
    for (const vo of vendorOrderIds) {
      batch.update(doc(vendorOrdersCollection(vo.storeId), vo.vendorOrderId), {
        paymentStatus: PAYMENT_STATUS.PAID,
        paymentBadge: badge,
        visibleToVendor: true,
        paidAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  batch.update(doc(db, CUSTOMER_ORDERS, customerOrder.id), {
    ...paidFields,
    paymentMethod,
    cashierName,
    paidAt: serverTimestamp(),
    verificationCode,
    settlements,
    totalCommission,
    totalVendorNet,
    vendorOrderIds,
    updatedAt: serverTimestamp(),
  });

  const payoutRef = doc(collection(db, "vendorPayouts"));
  batch.set(payoutRef, {
    customerOrderId: customerOrder.id,
    settlements,
    totalCommission,
    totalVendorNet,
    grandTotal: customerOrder.grandTotal,
    status: "pending",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
  return { verificationCode, settlements, totalCommission, totalVendorNet };
}

export async function updateVendorOrderStatus(storeId, vendorOrderId, status) {
  const payload = {
    status,
    updatedAt: serverTimestamp(),
  };
  if (status === VENDOR_ORDER_STATUS.COMPLETED) {
    payload.completedAt = serverTimestamp();
  }
  await updateDoc(doc(vendorOrdersCollection(storeId), vendorOrderId), payload);
}

export async function markVendorOrderTransferred(storeId, vendorOrderId) {
  await updateDoc(doc(vendorOrdersCollection(storeId), vendorOrderId), {
    transferredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function subscribeVendorOrders(storeId, callback, { vendorVisibleOnly = true } = {}) {
  if (!storeId) return () => {};
  const q = query(vendorOrdersCollection(storeId), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      let list = snap.docs.map((d) => ({ id: d.id, storeId, ...d.data() }));
      if (vendorVisibleOnly) {
        list = list.filter((o) => o.visibleToVendor !== false && o.paymentBadge !== "BLOCKED");
      }
      callback(list);
    },
    (err) => {
      console.error("subscribeVendorOrders", err);
      callback([]);
    }
  );
}

export async function listDispatchedVendorOrdersForStores(storeIds) {
  const all = [];
  for (const storeId of storeIds) {
    const snap = await getDocs(query(vendorOrdersCollection(storeId), orderBy("createdAt", "desc")));
    snap.docs.forEach((d) => {
      const data = d.data();
      if (data.visibleToVendor !== false && data.paymentBadge !== "BLOCKED") {
        all.push({ id: d.id, storeId, ...data });
      }
    });
  }
  all.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  return all;
}
