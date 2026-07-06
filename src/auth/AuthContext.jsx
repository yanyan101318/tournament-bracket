// src/auth/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);  // Firebase auth user
  const [profile, setProfile] = useState(null);  // Firestore user doc
  const [role, setRole]       = useState(null);  // "admin" | "customer"
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubDoc = null;
    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        unsubDoc = onSnapshot(doc(db, "users", firebaseUser.uid), (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            setProfile(data);
            setRole(data.role);
          }
          setLoading(false);
        }, (err) => {
          console.error("Error fetching user profile:", err);
          setLoading(false);
        });
      } else {
        setUser(null);
        setProfile(null);
        setRole(null);
        setLoading(false);
        if (unsubDoc) {
          unsubDoc();
          unsubDoc = null;
        }
      }
    });
    return () => {
      unsubAuth();
      if (unsubDoc) unsubDoc();
    };
  }, []);

  async function logout() {
    await signOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, profile, setProfile, role, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}