// src/auth/LoginPage.jsx
import { useEffect, useState } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { grantRegisterAccess } from "./registerAccess";

/** Prefer REACT_APP_ADMIN_REGISTRATION_CODE in env; fallback for local/dev only. */
function getExpectedAdminCode() {
  return process.env.REACT_APP_ADMIN_REGISTRATION_CODE || "admin123";
}

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [adminCodeError, setAdminCodeError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "RANAW PICKLEBALL COURT | Login";
  }, []);

  function openRegisterModal() {
    setAdminCode("");
    setAdminCodeError("");
    setRegisterModalOpen(true);
  }

  function closeRegisterModal() {
    setRegisterModalOpen(false);
    setAdminCode("");
    setAdminCodeError("");
  }

  function handleAdminCodeSubmit(e) {
    e.preventDefault();
    setAdminCodeError("");
    const expected = getExpectedAdminCode();
    if (adminCode.trim() !== expected) {
      setAdminCodeError("Invalid admin code");
      return;
    }
    grantRegisterAccess();
    closeRegisterModal();
    navigate("/register", { replace: false });
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (!cred.user.emailVerified) {
        await signOut(auth);
        setError("Please verify your email before logging in.");
        setLoading(false);
        return;
      }
      const snap = await getDoc(doc(db, "users", cred.user.uid));
      if (snap.exists()) {
        const role = snap.data().role;
        if (role === "admin")    navigate("/admin/dashboard", { replace: true });
        else                     navigate("/user/home",       { replace: true });
      } else {
        await signOut(auth);
        setError("User profile not found. Contact admin.");
      }
    } catch (err) {
      setError(friendlyError(err.code));
    }
    setLoading(false);
  }

  function friendlyError(code) {
    switch (code) {
      case "auth/user-not-found":    return "No account found with this email.";
      case "auth/wrong-password":    return "Incorrect password.";
      case "auth/invalid-email":     return "Invalid email address.";
      case "auth/too-many-requests": return "Too many attempts. Try again later.";
      default:                       return "Login failed. Please try again.";
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-left">
        <div className="auth-brand">
          <div className="auth-brand-icon">🏓</div>
          <h1 className="auth-brand-name">RANAW PICKLEBALL COURT</h1>
          <p className="auth-brand-tagline">Court Reservation Management</p>
        </div>
        <div className="auth-left-features">
          <div className="alf-item"><span className="alf-icon"></span><span>Tournament Management</span></div>
          <div className="alf-item"><span className="alf-icon"></span><span>Court Booking</span></div>
          <div className="alf-item"><span className="alf-icon"></span><span>Payment Processing</span></div>
          <div className="alf-item"><span className="alf-icon"></span><span>Analytics Dashboard</span></div>
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-card">
          <div className="auth-card-header">
            <h2 className="auth-card-title">Welcome to RANAW PICKLEBALL COURT</h2>
            <p className="auth-card-sub">Book your court with ease</p>
          </div>

          <form className="auth-form" onSubmit={handleLogin}>
            <div className="af-group">
              <label className="af-label">Email address</label>
              <input
                className="af-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div className="af-group">
              <label className="af-label">Password</label>
              <div className="af-input-wrap">
                <input
                  className="af-input"
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button type="button" className="af-eye" onClick={() => setShowPass(p => !p)}>
                  {showPass ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            {error && <div className="af-error"><span>⚠</span>{error}</div>}

            <button className="af-submit" type="submit" disabled={loading}>
              {loading ? <span className="af-spinner"/> : "Sign In"}
            </button>
          </form>

          <div className="auth-card-footer">
          Access restricted.{" "}
            <button type="button" className="auth-link auth-link-btn" onClick={openRegisterModal}>
            Request Admin Credentials
            </button>
          </div>
        </div>
      </div>

      {registerModalOpen && (
        <div
          className="auth-modal-backdrop"
          role="presentation"
          onClick={closeRegisterModal}
        >
          <div
            className="auth-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="auth-modal-title" className="auth-modal-title">
              Administrator access
            </h3>
            <p className="auth-modal-desc">
              Enter the admin registration code to create an administrator account.
            </p>
            <form className="auth-modal-form" onSubmit={handleAdminCodeSubmit}>
              <label className="af-label" htmlFor="admin-access-code">
                Admin code
              </label>
              <input
                id="admin-access-code"
                className="af-input"
                type="password"
                autoComplete="off"
                value={adminCode}
                onChange={(e) => setAdminCode(e.target.value)}
                placeholder="Enter code"
              />
              {adminCodeError && (
                <div className="af-error auth-modal-error">
                  <span>⚠</span>
                  {adminCodeError}
                </div>
              )}
              <div className="auth-modal-actions">
                <button type="button" className="auth-modal-cancel" onClick={closeRegisterModal}>
                  Cancel
                </button>
                <button type="submit" className="auth-modal-confirm">
                  Continue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}