import os

file_path = r"c:\Users\lausi\tournament-bracket - latest\src\admin\BookingManager.jsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace 1: Approval
old_approve = """      await wrapSync(batch.commit(), {
        successMsg: "Payment approved successfully",
        offlineMsg: "Approval queued for sync"
      });"""

new_approve = """      await wrapSync(batch.commit(), {
        successMsg: "Payment approved successfully",
        offlineMsg: "Approval queued for sync",
        silent: true // handle toast manually
      });

      setActing("payment_approve_sms");
      const smsMsg = "RANAW PICKLEBALL COURT: Your booking has been APPROVED. Please arrive on your scheduled time. Thank you for choosing RANAW PICKLEBALL COURT.";
      const smsRes = await sendBookingSMS(selected.id, selected.contactNumber, smsMsg);
      
      if (smsRes.success) {
        toast.success("Booking approved and SMS sent successfully");
      } else {
        if (smsRes.code === "no_number") {
          toast.success("Booking updated but SMS could not be sent (missing contact number)");
        } else if (smsRes.code === "invalid_format") {
          toast.success("Booking updated but SMS failed due to invalid phone number");
        } else {
          toast.error("Booking updated but SMS service failed");
        }
      }"""

# Replace 2: Rejection
old_reject = """      await wrapSync(batch.commit(), {
        successMsg: "Payment rejected",
        offlineMsg: "Rejection queued for sync"
      });
      setRejectReasonModal({ open: false, reason: "" });"""

new_reject = """      await wrapSync(batch.commit(), {
        successMsg: "Payment rejected",
        offlineMsg: "Rejection queued for sync",
        silent: true // handle toast manually
      });
      setRejectReasonModal({ open: false, reason: "" });

      setActing("payment_reject_sms");
      const smsMsg = "RANAW PICKLEBALL COURT: Your booking has been REJECTED. Please review your booking details or contact support for assistance. Thank you.";
      const smsRes = await sendBookingSMS(selected.id, selected.contactNumber, smsMsg);
      
      if (smsRes.success) {
        toast.success("Booking rejected and SMS notification sent");
      } else {
        if (smsRes.code === "no_number") {
          toast.success("Booking updated but SMS could not be sent (missing contact number)");
        } else if (smsRes.code === "invalid_format") {
          toast.success("Booking updated but SMS failed due to invalid phone number");
        } else {
          toast.error("Booking updated but SMS service failed");
        }
      }"""

# Replace 3: Buttons
old_btn1 = """                      <button className="text-xs font-bold bg-red-500 text-white px-4 py-1.5 rounded-md hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20" onClick={rejectPayment} disabled={acting === "payment_reject"}>
                        {acting === "payment_reject" ? "Rejecting..." : "Confirm Reject"}
                      </button>"""

new_btn1 = """                      <button className="text-xs font-bold bg-red-500 text-white px-4 py-1.5 rounded-md hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20" onClick={rejectPayment} disabled={acting === "payment_reject" || acting === "payment_reject_sms"}>
                        {acting === "payment_reject" ? "Rejecting..." : acting === "payment_reject_sms" ? "Sending SMS..." : "Confirm Reject"}
                      </button>"""

old_btn2 = """                    <button 
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 px-4 rounded-lg transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                      onClick={approvePayment}
                      disabled={!linkedPayment || acting || linkedPayment.paymentStatus === "Approved"}
                    >
                      {acting === "payment_approve" ? "Approving..." : "Approve Payment"}
                    </button>"""

new_btn2 = """                    <button 
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 px-4 rounded-lg transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                      onClick={approvePayment}
                      disabled={!linkedPayment || acting || linkedPayment.paymentStatus === "Approved"}
                    >
                      {acting === "payment_approve" ? "Approving..." : acting === "payment_approve_sms" ? "Sending SMS..." : "Approve Payment"}
                    </button>"""

content = content.replace(old_approve.replace('\n', '\r\n'), new_approve.replace('\n', '\r\n'))
content = content.replace(old_reject.replace('\n', '\r\n'), new_reject.replace('\n', '\r\n'))
content = content.replace(old_btn1.replace('\n', '\r\n'), new_btn1.replace('\n', '\r\n'))
content = content.replace(old_btn2.replace('\n', '\r\n'), new_btn2.replace('\n', '\r\n'))

content = content.replace(old_approve, new_approve)
content = content.replace(old_reject, new_reject)
content = content.replace(old_btn1, new_btn1)
content = content.replace(old_btn2, new_btn2)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)
print("Updated successfully")
