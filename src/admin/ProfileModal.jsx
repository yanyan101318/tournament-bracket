import { useState, useRef } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../auth/AuthContext";
import toast from "react-hot-toast";

const PREDEFINED_AVATARS = [
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Felix",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Max",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Lily",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Jude",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Sam",
];

const DEFAULT_AVATAR = "https://lh3.googleusercontent.com/aida-public/AB6AXuCN2G52zKcQynqcDn68fQ0l2-2R_sUyjlQmzSidfD1KEUB5swEGfwLzkKOhJP0mC1tzXR0Q57ZOkSgT_e1p3tDFFFZsXgBqsH4EwxfR4F9FNKK_rBUJpYot5FbVS4pZ2FuLqMjGGvEMVOABhj0FGFzZo0v8g1cPPe2qmc9bkGd_od-WQD_OFNhw_3OIxnlcDQht8cuEyYEKPT1tSon0qRPzTiGEMegm0S1-eUm1r0P3w3-wLo0lnv4f9z0itnBiUGdB9HebRcIrMwg";

export default function ProfileModal({ onClose }) {
  const { user, profile, setProfile } = useAuth();
  const fileInputRef = useRef(null);
  
  const [saving, setSaving] = useState(false);
  
  // Current selected avatar (either their existing one, or a new selection before save)
  const [selectedAvatar, setSelectedAvatar] = useState(profile?.avatar || DEFAULT_AVATAR);
  
  // Temporary selected file if they upload
  const [, setUploadedBase64] = useState(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        
        // Resize to 256x256
        const MAX_SIZE = 256;
        
        // Calculate crop to make it a perfect square
        const size = Math.min(img.width, img.height);
        const startX = (img.width - size) / 2;
        const startY = (img.height - size) / 2;
        
        canvas.width = MAX_SIZE;
        canvas.height = MAX_SIZE;
        
        ctx.drawImage(img, startX, startY, size, size, 0, 0, MAX_SIZE, MAX_SIZE);
        
        const compressedBase64 = canvas.toDataURL("image/jpeg", 0.8);
        setUploadedBase64(compressedBase64);
        setSelectedAvatar(compressedBase64);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const handleSelectPredefined = (url) => {
    setUploadedBase64(null); // Clear uploaded file if they click a predefined one
    setSelectedAvatar(url);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        avatar: selectedAvatar
      });
      if (setProfile && profile) {
        setProfile({ ...profile, avatar: selectedAvatar });
      }
      toast.success("Profile updated!");
      onClose();
    } catch (err) {
      console.error(err);
      toast.error("Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[210] w-[min(90vw,500px)] bg-[#151e2d] border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-center bg-[#0a0f18]/50">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-cyan-400">person</span>
            My Profile
          </h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          <div className="flex flex-col md:flex-row gap-6 mb-8">
            <div className="flex flex-col items-center gap-3 shrink-0">
              <div className="w-24 h-24 rounded-full border-4 border-slate-800 overflow-hidden shadow-xl bg-slate-900">
                <img src={selectedAvatar} alt="Profile" className="w-full h-full object-cover" />
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 hover:border-cyan-400 rounded-lg px-3 py-1.5 transition-colors bg-cyan-500/10"
              >
                Upload Photo
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />
            </div>
            <div className="flex-1 flex flex-col justify-center space-y-3">
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Name</div>
                <div className="text-base font-semibold text-white">{profile?.name || "Administrator"}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Email</div>
                <div className="text-sm text-slate-300">{user?.email || "No email"}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Role</div>
                <div className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {profile?.role || "Admin"}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Or choose an avatar</div>
            <div className="grid grid-cols-6 gap-2">
              {PREDEFINED_AVATARS.map((url, i) => (
                <button
                  key={i}
                  onClick={() => handleSelectPredefined(url)}
                  className={`relative aspect-square rounded-full overflow-hidden border-2 transition-all hover:scale-110 ${
                    selectedAvatar === url ? "border-cyan-400 scale-110 shadow-[0_0_15px_rgba(34,211,238,0.4)]" : "border-slate-700 hover:border-slate-500"
                  }`}
                >
                  <img src={url} alt={`Avatar option ${i + 1}`} className="w-full h-full object-cover bg-slate-800" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-800 flex justify-end gap-3 bg-[#0a0f18]/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 transition-colors shadow-lg shadow-cyan-500/20 flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[18px]">sync</span>
                Saving...
              </>
            ) : (
              "Save Profile"
            )}
          </button>
        </div>
      </div>
    </>
  );
}
