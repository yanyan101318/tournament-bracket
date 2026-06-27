import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { getEffectiveCourtStatus } from '../lib/bookingSlots';

export function useSystemCourts() {
  const [courts, setCourts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "courts"), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const allCourts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filter only active courts using the same logic as CourtManager
      const activeCourts = allCourts.filter(c => getEffectiveCourtStatus(c));
      setCourts(activeCourts);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching courts:", error);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return { courts, loading };
}
