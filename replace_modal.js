const fs = require('fs');

const file = 'src/admin/BookingManager.jsx';
let content = fs.readFileSync(file, 'utf8');

const startStr = '{/* Detail modal */}';
const endStr = '{balanceModal.open && balanceModal.booking && (';

const startIndex = content.indexOf(startStr);
const endIndex = content.indexOf(endStr);

if (startIndex === -1 || endIndex === -1) {
  console.log("Could not find boundaries");
  process.exit(1);
}

const replacement = `{/* Detail modal */}
      {selected && (
        <div className="ad-modal-backdrop" onClick={()=>setSelected(null)}>
          <div className="ad-modal ad-modal-booking flex flex-col md:flex-row bg-[#0f172a]/95 backdrop-blur-xl border border-slate-700 shadow-2xl rounded-2xl overflow-hidden" style={{ maxWidth: '1200px', width: '96vw' }} onClick={e=>e.stopPropagation()}>
            {/* LEFT COLUMN: INFO */}
            <div className="flex-1 flex flex-col max-h-[85vh] overflow-y-auto custom-scrollbar border-r border-slate-800">
              <div className="ad-modal-header sticky top-0 bg-[#0f172a]/95 backdrop-blur-md z-10 border-b border-slate-800">
                <h3>Booking & Payment Details</h3>
                <button className="ad-modal-close lg:hidden" onClick={()=>setSelected(null)}>✕</button>
              </div>
              <div className="p-4 space-y-6">
                {/* Booking Info */}
                <div>
                  <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-3">Booking Information</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="ad-detail-row"><span>Player</span><strong>{selected.playerName??selected.userId??'—'}</strong></div>
                    <div className="ad-detail-row"><span>Contact</span><strong>{selected.contactNumber ?? "—"}</strong></div>
                    <div className="ad-detail-row"><span>Court</span><strong>{selected.courtName??selected.courtId??'—'}</strong></div>
                    <div className="ad-detail-row"><span>Date</span><strong>{selected.date??'—'}</strong></div>
                    <div className="ad-detail-row"><span>Time Slot</span><strong>{selected.timeSlot??'—'}</strong></div>
                    <div className="ad-detail-row"><span>Duration</span><strong>{selected.duration ?? "—"} hr</strong></div>
                    <div className="ad-detail-row"><span>Total</span><strong>₱{roundMoney(Number(selected.totalAmount)||0).toFixed(2)}</strong></div>
                    <div className="ad-detail-row"><span>Paid</span><strong>₱{roundMoney(Number(selected.amountPaid)||0).toFixed(2)}</strong></div>
                    <div className="ad-detail-row"><span>Balance</span><strong>₱{deriveRemainingBalance(selected).toFixed(2)}</strong></div>
                    <div className="ad-detail-row"><span>Booking Status</span>
                      <span className={\`ad-badge ad-badge-\${STATUS_COLORS[selected.status]??"pending"} mt-1 w-fit\`}>{selected.status??"Pending"}</span>
                    </div>
                  </div>
                </div>

                {/* Payment Info */}
                {linkedPayment && (
                  <div>
                    <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-3">Payment Record</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="ad-detail-row"><span>Amount</span><strong>₱{roundMoney(Number(linkedPayment.amount)||0).toFixed(2)}</strong></div>
                      <div className="ad-detail-row"><span>Discount</span><strong>₱{roundMoney(Number(linkedPayment.discount)||0).toFixed(2)}</strong></div>
                      <div className="ad-detail-row"><span>Promo Code</span><strong>{linkedPayment.promoCode ?? "None"}</strong></div>
                      <div className="ad-detail-row"><span>Method</span><strong className="capitalize">{linkedPayment.method ?? "—"}</strong></div>
                      <div className="ad-detail-row"><span>Status</span>
                        <span className={\`ad-badge ad-badge-\${PAY_STATUS_BADGE[(linkedPayment.paymentStatus||"").toLowerCase()]??"pending"} mt-1 w-fit\`}>
                          {linkedPayment.paymentStatus ?? "Pending"}
                        </span>
                      </div>
                      <div className="ad-detail-row"><span>Created At</span><strong>{linkedPayment.createdAt?.toDate ? format(linkedPayment.createdAt.toDate(), "MMM dd, yyyy — h:mm a") : "—"}</strong></div>
                      <div className="ad-detail-row"><span>Reviewed At</span><strong>{linkedPayment.reviewedAt?.toDate ? format(linkedPayment.reviewedAt.toDate(), "MMM dd, yyyy — h:mm a") : "Not reviewed"}</strong></div>
                    </div>
                  </div>
                )}
                
                {!linkedPayment && (
                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 flex items-center justify-center text-sm text-slate-500 font-medium">
                    No linked payment record found for this booking.
                  </div>
                )}

                {/* Extend Time */}
                {selected.status !== "Cancelled" && (
                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/30">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Extend time</p>
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">Add hours</label>
                        <select
                          className="ad-search text-sm py-2"
                          value={extendHours}
                          onChange={(e) => setExtendHours(Number(e.target.value))}
                        >
                          {EXTEND_OPTIONS.map((h) => (
                            <option key={h} value={h}>+{h} hr</option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        className="ad-btn ad-btn-sm ad-btn-success"
                        disabled={extending}
                        onClick={() => applyExtension(selected)}
                      >
                        {extending ? "…" : "Extend"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="mt-auto p-4 border-t border-slate-800 bg-[#0f172a]/95 sticky bottom-0 z-10 flex flex-wrap gap-2 items-center justify-between">
                <button
                  type="button"
                  className="ad-btn ad-btn-outline ad-btn-sm"
                  disabled={acting===selected.id}
                  onClick={() => removeBooking(selected.id)}
                >
                  Delete Booking
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="ad-btn ad-btn-primary ad-btn-sm"
                    disabled={acting===selected.id}
                    onClick={() => handlePrintReceipt(selected)}
                  >
                    Print Receipt
                  </button>
                  {deriveRemainingBalance(selected) > 0 && selected.status !== "Cancelled" && (
                    <button
                      className="ad-btn ad-btn-sm ad-btn-success"
                      disabled={acting===selected.id}
                      onClick={() => openBalanceModal(selected)}
                    >
                      + Pay balance
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: PAYMENT PREVIEW & ACTIONS */}
            <div className="md:w-[420px] lg:w-[500px] flex-shrink-0 flex flex-col bg-slate-900/50 relative max-h-[85vh]">
              <div className="absolute top-4 right-4 z-20 hidden lg:block">
                <button className="w-8 h-8 rounded-full bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center transition-colors shadow-lg" onClick={()=>setSelected(null)}>✕</button>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Payment Proof Preview</h4>
                
                {linkedPayment?.paymentImageUrl ? (
                  <div 
                    className="relative rounded-xl overflow-hidden border border-slate-700 bg-black/50 shadow-2xl cursor-pointer group flex-1 min-h-[300px]"
                    onClick={() => setZoomImage(linkedPayment.paymentImageUrl)}
                  >
                    <img 
                      src={linkedPayment.paymentImageUrl} 
                      alt="Payment Proof" 
                      className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                      <div className="flex flex-col items-center gap-2 text-white">
                        <span className="material-symbols-outlined text-4xl">zoom_in</span>
                        <span className="text-sm font-semibold tracking-wide">Click to Zoom</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-h-[300px] rounded-xl border border-dashed border-slate-700 bg-slate-800/30 flex flex-col items-center justify-center text-slate-500 gap-3">
                    <span className="material-symbols-outlined text-4xl opacity-50">receipt_long</span>
                    <p className="text-sm font-medium">No payment proof uploaded</p>
                  </div>
                )}

                {/* Reject Reason Input (conditionally visible) */}
                {rejectReasonModal.open && (
                  <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 shadow-inner">
                    <label className="text-[11px] font-bold text-red-400 uppercase tracking-wide block mb-2">Rejection Reason</label>
                    <textarea 
                      className="w-full bg-slate-900/80 border border-red-500/30 rounded-lg p-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 resize-none"
                      rows="2"
                      placeholder="Why is this payment being rejected?"
                      value={rejectReasonModal.reason}
                      onChange={(e) => setRejectReasonModal(prev => ({...prev, reason: e.target.value}))}
                    ></textarea>
                    <div className="flex gap-2 mt-3 justify-end">
                      <button className="text-xs font-semibold text-slate-400 hover:text-white px-3 py-1.5" onClick={() => setRejectReasonModal({open:false, reason:""})}>Cancel</button>
                      <button className="text-xs font-bold bg-red-500 text-white px-4 py-1.5 rounded-md hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20" onClick={rejectPayment} disabled={acting === "payment_reject"}>
                        {acting === "payment_reject" ? "Rejecting..." : "Confirm Reject"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons Footer */}
              <div className="p-4 border-t border-slate-800 bg-slate-900/80 backdrop-blur-md sticky bottom-0 z-10 flex flex-col gap-2">
                {!rejectReasonModal.open && (
                  <div className="flex gap-2 w-full">
                    <button 
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 px-4 rounded-lg transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                      onClick={approvePayment}
                      disabled={!linkedPayment || acting || linkedPayment.paymentStatus === "Approved"}
                    >
                      {acting === "payment_approve" ? "Approving..." : "Approve Payment"}
                    </button>
                    <button 
                      className="flex-1 bg-red-500/10 border border-red-500/30 hover:bg-red-500 hover:text-white text-red-400 font-bold py-2.5 px-4 rounded-lg transition-all disabled:opacity-50"
                      onClick={() => setRejectReasonModal({ open: true, reason: "" })}
                      disabled={!linkedPayment || acting || linkedPayment.paymentStatus === "Rejected"}
                    >
                      Reject
                    </button>
                  </div>
                )}
                <button 
                  className="w-full bg-transparent border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 font-semibold py-2 px-4 rounded-lg transition-colors text-sm disabled:opacity-50"
                  onClick={setPaymentPending}
                  disabled={!linkedPayment || acting || linkedPayment.paymentStatus === "Pending"}
                >
                  {acting === "payment_pending" ? "Setting..." : "Set as Pending Review"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Zoom Image Modal */}
      {zoomImage && (
        <div className="fixed inset-0 z-[300] bg-black/90 flex items-center justify-center backdrop-blur-sm p-4 lg:p-8" onClick={() => setZoomImage(null)}>
          <button className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-colors backdrop-blur-md" onClick={() => setZoomImage(null)}>
            <span className="material-symbols-outlined">close</span>
          </button>
          <img 
            src={zoomImage} 
            alt="Fullscreen Payment Proof" 
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <a 
            href={zoomImage} 
            download="payment-proof.jpg" 
            target="_blank" 
            rel="noopener noreferrer"
            className="absolute bottom-6 right-6 flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2.5 px-5 rounded-full transition-all shadow-lg shadow-cyan-500/20"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="material-symbols-outlined text-[20px]">download</span>
            Download
          </a>
        </div>
      )}
      
      `;

content = content.substring(0, startIndex) + replacement + content.substring(endIndex);
fs.writeFileSync(file, content);
console.log("Replaced successfully");
