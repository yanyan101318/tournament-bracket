import os

pos_path = "src/admin/PosPage.jsx"

with open(pos_path, "r", encoding="utf-8") as f:
    pos_content = f.read()

# 1. Update filter logic for the checkout view
# Old: orders.filter((o) => o.status === "sent_to_stalls" || o.status === "PAID" || o.status === "waived")
# New: orders.filter((o) => o.status === "sent_to_stalls")
pos_content = pos_content.replace(
    'orders.filter((o) => o.status === "sent_to_stalls" || o.status === "PAID" || o.status === "waived")',
    'orders.filter((o) => o.status === "sent_to_stalls")'
)

# 2. Update handleMarkPaid inside CourtOrderCheckoutCard
old_handle_mark_paid = """  async function handleMarkPaid() {
    if (cashAmount < grandTotal) {
       toast.error("Cash received must be at least the total amount.");
       return;
    }
    setSubmitting(true);
    try {
       await updateDoc(doc(db, "courtOrders", order.id), { status: "PAID", paidAt: serverTimestamp(), amountPaid: cashAmount, changeDue: changeDue });
       toast.success("Order marked as PAID!");
       setCash("");
    } catch(e) {
       console.error(e);
       toast.error("Failed to update payment");
    } finally {
       setSubmitting(false);
    }
  }"""

new_handle_mark_paid = """  async function handleMarkPaid() {
    if (cashAmount < grandTotal) {
       toast.error("Cash received must be at least the total amount.");
       return;
    }
    setSubmitting(true);
    try {
       const batch = writeBatch(db);
       
       const orderRef = doc(db, "courtOrders", order.id);
       batch.update(orderRef, { status: "PAID", paidAt: serverTimestamp(), amountPaid: cashAmount, changeDue: changeDue });
       
       const flattenedItems = [];
       if (order.cartGroups) {
         Object.values(order.cartGroups).forEach(group => {
           if (group.items) {
             group.items.forEach(item => flattenedItems.push(item));
           }
         });
       }
       
       const txRef = doc(collection(db, "salesTransactions"));
       batch.set(txRef, {
         type: "pos",
         source: "court_order",
         orderId: order.id,
         customerName: order.bookerName || order.guestName || "Guest",
         vendorName: "Court Food Orders",
         items: flattenedItems,
         total: grandTotal,
         paymentMethod: "Cash",
         cashReceived: cashAmount,
         change: changeDue,
         createdAt: serverTimestamp(),
       });
       
       await batch.commit();
       toast.success("Order marked as PAID!");
       setCash("");
    } catch(e) {
       console.error(e);
       toast.error("Failed to update payment");
    } finally {
       setSubmitting(false);
    }
  }"""

pos_content = pos_content.replace(old_handle_mark_paid, new_handle_mark_paid)

# Also fix the "No orders pending payment" message to reflect the new filter if it's there
pos_content = pos_content.replace(
    'orders.filter((o) => o.status === "sent_to_stalls" || o.status === "PAID" || o.status === "waived").length === 0',
    'orders.filter((o) => o.status === "sent_to_stalls").length === 0'
)


with open(pos_path, "w", encoding="utf-8") as f:
    f.write(pos_content)

print("Patch 2 applied successfully.")
