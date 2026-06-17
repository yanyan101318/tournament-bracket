// src/auth/RegisterPage.jsx
import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { useNavigate, Link } from "react-router-dom";
import { auth, db } from "../firebase";
import {
  isRegisterAccessGranted,
  clearRegisterAccess,
} from "./registerAccess";
import RanawLogo from "../components/RanawLogo";

export default function RegisterPage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "RANAW PICKLEBALL COURT | Register";
    if (!isRegisterAccessGranted()) {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  function set(k, v) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (!form.phone.trim()) {
      setError("Phone number is required.");
      return;
    }
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        form.email,
        form.password
      );
      await sendEmailVerification(cred.user);
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        role: "admin",
        createdAt: serverTimestamp(),
      });
      await signOut(auth);
      clearRegisterAccess();
      setVerificationSent(true);
    } catch (err) {
      setError(friendlyError(err.code));
    }
    setLoading(false);
  }

  function friendlyError(code) {
    switch (code) {
      case "auth/email-already-in-use":
        return "This email is already registered.";
      case "auth/invalid-email":
        return "Invalid email address.";
      case "auth/weak-password":
        return "Password is too weak.";
      default:
        return "Registration failed. Please try again.";
    }
  }

  if (verificationSent) {
    return (
      <div className="auth-page">
        <div className="auth-left">
          <div className="auth-brand">
            <RanawLogo variant="auth" />
            <p className="auth-brand-tagline">Court Reservation Management</p>
          </div>
          <div className="auth-left-features">
            <div className="alf-item">
              <span className="alf-icon">🏆</span>
              <span>Tournament Management</span>
            </div>
            <div className="alf-item">
              <span className="alf-icon">📅</span>
              <span>Court Booking</span>
            </div>
            <div className="alf-item">
              <span className="alf-icon">💳</span>
              <span>Payment Processing</span>
            </div>
            <div className="alf-item">
              <span className="alf-icon">📊</span>
              <span>Analytics Dashboard</span>
            </div>
          </div>
        </div>

        <div className="auth-right">
          <div className="auth-card">
            <div className="auth-card-logo">
              <RanawLogo variant="authCard" />
            </div>
            <div className="auth-card-header">
              <h2 className="auth-card-title">Check your email</h2>
              <p className="auth-card-sub">
                Verification email sent. Please check your email before logging in.
              </p>
            </div>
            <p className="auth-success-note">
              After you verify your email, you can sign in with your administrator account.
            </p>
            <Link to="/login" className="af-submit auth-success-link">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-left">
        <div className="auth-brand">
          <RanawLogo variant="auth" />
          <p className="auth-brand-tagline">Court Reservation Management</p>
        </div>
        <div className="auth-left-features">
          <div className="alf-item">
            <span className="alf-icon">🏆</span>
            <span>Tournament Management</span>
          </div>
          <div className="alf-item">
            <span className="alf-icon">📅</span>
            <span>Court Booking</span>
          </div>
          <div className="alf-item">
            <span className="alf-icon">💳</span>
            <span>Payment Processing</span>
          </div>
          <div className="alf-item">
            <span className="alf-icon">📊</span>
            <span>Analytics Dashboard</span>
          </div>
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-card">
          <div className="auth-card-logo">
            <RanawLogo variant="authCard" />
          </div>
          <div className="auth-card-header">
            <h2 className="auth-card-title">Create your RANAW PICKLEBALL COURT account</h2>
            <p className="auth-card-sub">
              New accounts are administrators. You must verify your email before signing in.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleRegister}>
            <div className="af-row">
              <div className="af-group">
                <label className="af-label">Full name</label>
                <input
                  className="af-input"
                  type="text"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Juan dela Cruz"
                  required
                />
              </div>
              <div className="af-group">
                <label className="af-label">Phone number</label>
                <input
                  className="af-input"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="09XX XXX XXXX"
                  required
                />
              </div>
            </div>

            <div className="af-group">
              <label className="af-label">Email address</label>
              <input
                className="af-input"
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="af-row">
              <div className="af-group">
                <label className="af-label">Password</label>
                <div className="af-input-wrap">
                  <input
                    className="af-input"
                    type={showPass ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    placeholder="Min. 6 characters"
                    required
                  />
                  <button
                    type="button"
                    className="af-eye"
                    onClick={() => setShowPass((p) => !p)}
                  >
                    {showPass ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>
              <div className="af-group">
                <label className="af-label">Confirm password</label>
                <input
                  className="af-input"
                  type="password"
                  value={form.confirm}
                  onChange={(e) => set("confirm", e.target.value)}
                  placeholder="Repeat password"
                  required
                />
              </div>
            </div>

            <div className="af-group">
              <label className="af-label">Account type</label>
              <div className="af-role-single">
                <span className="af-role-single-icon">🔧</span>
                <span>Administrator</span>
              </div>
            </div>

            {error && (
              <div className="af-error">
                <span>⚠</span>
                {error}
              </div>
            )}

            <button className="af-submit" type="submit" disabled={loading}>
              {loading ? <span className="af-spinner" /> : "Create Account"}
            </button>
          </form>

          <div className="auth-card-footer">
            Already have an account?{" "}
            <Link to="/login" className="auth-link">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
