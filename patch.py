import os

bm_path = "src/admin/BookingManager.jsx"
pos_path = "src/admin/PosPage.jsx"

with open(bm_path, "r", encoding="utf-8") as f:
    bm_content = f.read()

# Remove CourtOrderCheckoutCard and BookingCourtOrders from BookingManager
start_idx = bm_content.find("function CourtOrderCheckoutCard({ order }) {")
end_idx = bm_content.find("function deriveRemainingBalance(row) {")

if start_idx != -1 and end_idx != -1:
    card_code = bm_content[start_idx:end_idx]
    bm_content = bm_content[:start_idx] + bm_content[end_idx:]

# Remove <BookingCourtOrders booking={selected} />
bm_content = bm_content.replace("<BookingCourtOrders booking={selected} />", "")

with open(bm_path, "w", encoding="utf-8") as f:
    f.write(bm_content)

with open(pos_path, "r", encoding="utf-8") as f:
    pos_content = f.read()

# Add format import
if 'import { format } from "date-fns";' not in pos_content:
    pos_content = pos_content.replace(
        'import FoodCourtPosLayout from "./FoodCourtPosLayout";',
        'import FoodCourtPosLayout from "./FoodCourtPosLayout";\nimport { format } from "date-fns";'
    )

# Add CourtOrderCheckoutCard to PosPage
# We modify it slightly to show "PENDING FOR PAYMENT" instead of "SENT TO STALLS"
card_code_modified = card_code.replace(
    'if (isPaid && !isWaived) displayStatus = "PAID";',
    'if (order.status === "sent_to_stalls") displayStatus = "PENDING FOR PAYMENT";\n  if (isPaid && !isWaived) displayStatus = "PAID";'
)

if "function CourtOrderCheckoutCard" not in pos_content:
    pos_content = pos_content.replace(
        "function roundMoney(n) {",
        card_code_modified + "\nfunction roundMoney(n) {"
    )

# Now update the activeTab === "courtOrders" layout
# We want to replace the current <div className="space-y-4"> block inside activeTab === "courtOrders"

search_str = '{activeTab === "courtOrders" && ('
layout_start = pos_content.find(search_str)

new_layout = """{activeTab === "courtOrders" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT SIDE: Confirm Orders */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-cyan-400 border-b border-slate-800 pb-2">Orders to Confirm</h2>
            {orders.filter((o) => o.status === "approved").length === 0 ? (
              <div className="ad-empty border border-dashed border-[var(--ad-border)] rounded-xl py-12">
                No approved court orders. Orders must be approved by the booker first.
              </div>
            ) : (
              <div className="space-y-4">
                {orders
                  .filter((o) => o.status === "approved")
                  .map((order) => (
                    <div
                      key={order.id}
                      className="bg-[var(--ad-surface)] border border-[var(--ad-border)] rounded-xl p-4 flex flex-col shadow-sm"
                    >
                      <div className="flex justify-between items-start mb-3 border-b border-[var(--ad-border)] pb-3">
                        <div>
                          <h3 className="font-bold text-[var(--ad-text)]">{order.courtName || order.courtId}</h3>
                          <p className="text-xs text-cyan-400 font-semibold mb-1">Booker: {order.bookerName}</p>
                          <p className="text-xs text-[var(--ad-muted)]">Guest: {order.guestName}</p>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/50">
                          Approved
                        </span>
                      </div>

                      <div className="flex-1 mb-4 space-y-2 max-h-40 overflow-y-auto pr-1">
                        {Object.values(order.cartGroups || {}).map(group => (
                          <div key={group.storeId} className="mb-2">
                            <p className="text-xs font-bold text-[#84CC16] mb-1">{group.storeName}</p>
                            {group.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between text-sm pl-2 border-l-2 border-[var(--ad-border)]">
                                <span className="text-[var(--ad-text)]">
                                  {item.quantity}x {item.name}
                                </span>
                                <span className="text-[var(--ad-muted)]">
                                  {formatReceiptCurrency(item.lineTotal || 0)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-between items-center font-bold border-t border-[var(--ad-border)] pt-3 mb-4">
                        <span className="text-[var(--ad-text)]">Total</span>
                        <span className="text-emerald-400">
                          {formatReceiptCurrency(order.grandTotal || 0)}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2 mt-auto">
                        <button
                          className="ad-btn ad-btn-sm ad-btn-primary flex-1 justify-center"
                          onClick={() => confirmCourtOrder(order)}
                        >
                          Confirm & Send to Stalls
                        </button>
                        <button
                          className="ad-btn ad-btn-sm ad-btn-danger justify-center"
                          onClick={() => updateCourtOrderStatus(order.id, "rejected_by_admin")}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* RIGHT SIDE: Checkout / Payment */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-emerald-400 border-b border-slate-800 pb-2">Checkout / Payment</h2>
            {orders.filter((o) => o.status === "sent_to_stalls" || o.status === "PAID" || o.status === "waived").length === 0 ? (
              <div className="ad-empty border border-dashed border-[var(--ad-border)] rounded-xl py-12">
                No orders pending payment.
              </div>
            ) : (
              <div className="space-y-4">
                {orders
                  .filter((o) => o.status === "sent_to_stalls" || o.status === "PAID" || o.status === "waived")
                  .map(order => (
                    <CourtOrderCheckoutCard key={order.id} order={order} />
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {courtOrderPayModal && ("""

# Replace the old {activeTab === "courtOrders" && ( ... )} block
# It ends right before {courtOrderPayModal && (
end_layout = pos_content.find("{courtOrderPayModal && (")
if layout_start != -1 and end_layout != -1:
    pos_content = pos_content[:layout_start] + new_layout + pos_content[end_layout + len("{courtOrderPayModal && ("):]

with open(pos_path, "w", encoding="utf-8") as f:
    f.write(pos_content)

print("Patch applied successfully.")
