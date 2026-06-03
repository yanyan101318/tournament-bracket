import { useState, useEffect } from "react";
import { collection, query, onSnapshot, doc, updateDoc, Timestamp, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import toast from "react-hot-toast";

export default function MembershipRequests() {
  const [pendingMemberships, setPendingMemberships] = useState([]);
  const [verifyingUser, setVerifyingUser] = useState(null);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "RANAW PICKLEBALL COURT | Membership Requests";
    // Fetching from the dedicated 'membershipRequests' collection
    const q = query(collection(db, "membershipRequests"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPendingMemberships(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching memberships:", error);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  async function approveMembership(requestId, userDocId, plan) {
    if (!userDocId) {
      toast.error("Error: This request is missing a User ID.");
      return;
    }

    try {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);

      // Update the user's document to activate the membership
      await updateDoc(doc(db, "users", userDocId), {
        membershipRequestPending: false,
        membership: plan,
        membershipExpiry: Timestamp.fromDate(expiry),
      });

      // Update the request document to mark it as approved
      await updateDoc(doc(db, "membershipRequests", requestId), {
        status: "approved",
        approvedAt: serverTimestamp(),
      });

      toast.success(`${plan} membership approved!`);
      setVerifyingUser(null);
    } catch (error) {
      console.error(error);
      toast.error("Failed to approve membership.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400 mx-auto mb-2"></div>
          <span className="text-slate-400 text-sm">Loading requests...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="ad-page">
      <div className="ad-page-header">
        <div>
          <h1 className="ad-page-title">Membership Verifications</h1>
          <p className="ad-page-sub">Review and approve pending membership payments.</p>
        </div>
      </div>

      {pendingMemberships.filter(req => req.status !== "approved").length === 0 ? (
        <div className="bg-[#151e2d] border border-slate-800 rounded-xl p-12 text-center">
          <span className="material-symbols-outlined text-4xl text-slate-500 mb-3">check_circle</span>
          <h2 className="text-lg font-bold text-white mb-1">All caught up!</h2>
          <p className="text-slate-400">There are no pending membership requests right now.</p>
        </div>
      ) : (
        <div className="ad-card">
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Date Requested</th>
                  <th>Player Name</th>
                  <th>Plan</th>
                  <th>Receipt</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingMemberships
                  .filter(req => req.status !== "approved")
                  .map((request) => (
                    <tr key={request.id} className="ad-table-row">
                      <td className="text-xs text-slate-300">
                        {request.createdAt?.toDate
                          ? request.createdAt.toDate().toLocaleString()
                          : new Date(request.createdAt).toLocaleString()}
                      </td>
                      <td className="ad-td-main font-bold">
                        {request.playerName || request.name || "Unknown User"}
                        {request.phone && <div className="text-[10px] text-slate-400 font-normal">{request.phone}</div>}
                        {!request.phone && request.email && <div className="text-[10px] text-slate-400 font-normal">{request.email}</div>}
                      </td>
                      <td>
                        <span className="capitalize text-cyan-400 font-semibold bg-cyan-500/10 px-2 py-0.5 rounded text-xs">
                          {request.planId || request.plan || "Unknown"}
                        </span>
                      </td>
                      <td>
                        {request.paymentImageUrl ? (
                          <div className="h-10 w-10 rounded border border-slate-700 overflow-hidden cursor-pointer hover:border-cyan-500 transition-colors" onClick={() => setVerifyingUser(request)}>
                            <img src={request.paymentImageUrl} alt="Receipt" className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">None</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setVerifyingUser(request)}
                          className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded text-xs transition-colors"
                        >
                          Verify Payment
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {verifyingUser && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[100]" onClick={() => setVerifyingUser(null)}>
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-white">Verify Membership Payment</h3>
              <button
                type="button"
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
                onClick={() => setVerifyingUser(null)}
              >
                ✕
              </button>
            </div>

            <p className="text-sm text-slate-300 mb-4">
              Confirm payment for{" "}
              <strong className="text-white">
                {verifyingUser.playerName || verifyingUser.name}
              </strong>.
            </p>

            {verifyingUser.paymentImageUrl ? (
              <div 
                className="mb-6 rounded-xl overflow-hidden border border-slate-700 bg-slate-950 flex justify-center cursor-zoom-in relative group"
                onClick={() => setFullscreenImage(verifyingUser.paymentImageUrl)}
              >
                <img 
                  src={verifyingUser.paymentImageUrl} 
                  alt="Payment Receipt" 
                  className="max-h-[300px] object-contain"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="material-symbols-outlined text-white text-3xl">zoom_in</span>
                </div>
              </div>
            ) : (
              <div className="mb-6 p-4 rounded-xl border border-slate-700 bg-slate-800/50 text-center text-slate-400 text-sm">
                No payment image provided.
              </div>
            )}

            <button
              type="button"
              className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 rounded-lg text-slate-950 font-bold transition-colors mb-3 capitalize text-lg"
              onClick={() => approveMembership(verifyingUser.id, verifyingUser.userId, verifyingUser.planId || "pro")}
            >
              Approve as {verifyingUser.planId || "Pro"}
            </button>

            <button
              type="button"
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-white font-bold transition-colors"
              onClick={() => setVerifyingUser(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {fullscreenImage && (
        <div 
          className="fixed inset-0 bg-black/95 flex items-center justify-center p-4 z-[200] cursor-zoom-out" 
          onClick={() => setFullscreenImage(null)}
        >
          <img 
            src={fullscreenImage} 
            alt="Fullscreen Receipt" 
            className="max-w-full max-h-full object-contain rounded"
          />
          <button 
            className="absolute top-4 right-4 text-white hover:text-gray-300 p-2"
            onClick={() => setFullscreenImage(null)}
          >
            <span className="material-symbols-outlined text-4xl">close</span>
          </button>
        </div>
      )}
    </div>
  );
}
