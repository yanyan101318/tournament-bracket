import { useEffect, useState, useCallback, useRef } from "react";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import toast from "react-hot-toast";

// Collections to preload for offline access
const COLLECTIONS_TO_CACHE = [
  { name: "bookings", orderField: "createdAt", orderDirection: "desc", fetchLimit: 500 },
  { name: "payments", orderField: "createdAt", orderDirection: "desc", fetchLimit: 500 },
  { name: "salesTransactions", orderField: "createdAt", orderDirection: "desc", fetchLimit: 500 },
  { name: "products", orderField: "name", orderDirection: "asc", fetchLimit: 500 },
  { name: "inventoryItems", orderField: "name", orderDirection: "asc", fetchLimit: 500 },
  { name: "borrowRecords", orderField: "borrowedAt", orderDirection: "desc", fetchLimit: 500 },
  { name: "customers", orderField: "updatedAt", orderDirection: "desc", fetchLimit: 500 },
  { name: "announcements", orderField: "createdAt", orderDirection: "desc", fetchLimit: 100 },
  { name: "courts", orderField: "createdAt", orderDirection: "desc", fetchLimit: 100 },
  { name: "stores", orderField: "name", orderDirection: "asc", fetchLimit: 100 },
  { name: "customerOrders", orderField: "createdAt", orderDirection: "desc", fetchLimit: 200 },
  { name: "paddleMatchHistory", orderField: "endedAt", orderDirection: "desc", fetchLimit: 200 },
  { name: "users", orderField: null, orderDirection: null, fetchLimit: 500 },
];

export default function OfflinePreloader() {
  const preloadingRef = useRef(false);
  const [, setIsOnline] = useState(navigator.onLine);

  const preloadCache = useCallback(async () => {
    if (!navigator.onLine || preloadingRef.current) return;
    
    preloadingRef.current = true;
    const toastId = toast.loading("Preparing Offline Access...", { 
      position: "bottom-left",
      style: { background: "#151e2d", color: "#64748b", border: "1px solid #334155", fontSize: "12px" }
    });

    try {
      // Phase 1: Load first 20 records of each collection quickly
      await Promise.allSettled(
        COLLECTIONS_TO_CACHE.map(async (col) => {
          let q;
          if (col.orderField) {
            q = query(collection(db, col.name), orderBy(col.orderField, col.orderDirection), limit(20));
          } else {
            q = query(collection(db, col.name), limit(20));
          }
          return getDocs(q);
        })
      );

      // Phase 2: Progressively load remaining records in the background without blocking
      setTimeout(async () => {
        try {
          for (const col of COLLECTIONS_TO_CACHE) {
            if (!navigator.onLine) break; // Preserve what we have if we drop offline
            let q;
            if (col.orderField) {
              q = query(collection(db, col.name), orderBy(col.orderField, col.orderDirection), limit(col.fetchLimit));
            } else {
              q = query(collection(db, col.name), limit(col.fetchLimit));
            }
            await getDocs(q);
            // Small delay between large background fetches to keep UI thread responsive
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          toast.success("Offline Cache Ready", { id: toastId, duration: 3000, style: { background: "#151e2d", color: "#c8e63a", border: "1px solid #c8e63a30", fontSize: "12px" } });
        } catch (err) {
          console.error("Background progressive cache error:", err);
          toast.dismiss(toastId);
        } finally {
          preloadingRef.current = false;
        }
      }, 1500);

    } catch (err) {
      console.error("Initial preload error:", err);
      toast.dismiss(toastId);
      preloadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      preloadCache(); // Refresh cache when reconnecting
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [preloadCache]);

  // Run preload once on mount if online
  useEffect(() => {
    if (navigator.onLine) {
      preloadCache();
    }
  }, [preloadCache]);

  return null; // Silent component, handles background ops only
}
