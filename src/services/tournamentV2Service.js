import {
  collection,
  doc,
  setDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  writeBatch,
  serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase";

// --- TOURNAMENTS ---

export async function createTournamentV2(name, date, venue) {
  const id = `t-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const ref = doc(db, "tournamentsV2", id);
  await setDoc(ref, {
    id,
    name,
    date,
    venue,
    status: 'draft',
    createdAt: serverTimestamp()
  });
  return id;
}

export function subscribeToTournamentsV2(callback) {
  const q = query(collection(db, "tournamentsV2"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map(d => d.data()));
  });
}

export function subscribeToTournamentV2(id, callback) {
  const ref = doc(db, "tournamentsV2", id);
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) callback(snap.data());
    else callback(null);
  });
}

export async function updateTournamentV2(id, data) {
  const ref = doc(db, "tournamentsV2", id);
  await updateDoc(ref, data);
}

export async function deleteTournamentV2(id) {
  const ref = doc(db, "tournamentsV2", id);
  await deleteDoc(ref);
}

// --- DIVISIONS ---

export async function createDivision(tournamentId, data) {
  const ref = doc(collection(db, "tournamentsV2", tournamentId, "divisions"));
  const divData = {
    ...data,
    id: ref.id,
    tournamentId,
    status: 'draft',
    poolsGenerated: false,
    createdAt: serverTimestamp()
  };
  await setDoc(ref, divData);
  return ref.id;
}

export async function updateDivision(tournamentId, divisionId, data) {
  const ref = doc(db, "tournamentsV2", tournamentId, "divisions", divisionId);
  await updateDoc(ref, data);
}

export async function deleteDivision(tournamentId, divisionId) {
  const ref = doc(db, "tournamentsV2", tournamentId, "divisions", divisionId);
  await deleteDoc(ref);
}

export function subscribeToDivisions(tournamentId, callback) {
  const q = query(collection(db, "tournamentsV2", tournamentId, "divisions"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map(d => d.data()));
  });
}

// --- TEAMS ---

export async function addTeam(tournamentId, data) {
  const ref = doc(collection(db, "tournamentsV2", tournamentId, "teams"));
  const teamData = {
    ...data,
    id: ref.id,
    status: 'confirmed',
    createdAt: serverTimestamp()
  };
  await setDoc(ref, teamData);
  return ref.id;
}

export async function updateTeam(tournamentId, teamId, data) {
  const ref = doc(db, "tournamentsV2", tournamentId, "teams", teamId);
  await updateDoc(ref, data);
}

export async function deleteTeam(tournamentId, teamId) {
  const ref = doc(db, "tournamentsV2", tournamentId, "teams", teamId);
  await deleteDoc(ref);
}

export function subscribeToTeams(tournamentId, callback) {
  const q = query(collection(db, "tournamentsV2", tournamentId, "teams"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map(d => d.data()));
  });
}

// --- POOLS ---

export async function savePools(tournamentId, divisionId, pools, matches) {
  const batch = writeBatch(db);

  // Save Pools
  pools.forEach(pool => {
    const poolRef = doc(db, "tournamentsV2", tournamentId, "pools", pool.id);
    batch.set(poolRef, {
      ...pool,
      divisionId,
      createdAt: serverTimestamp()
    });
  });

  // Save Matches
  matches.forEach(match => {
    const matchRef = doc(db, "tournamentsV2", tournamentId, "matches", match.id);
    batch.set(matchRef, {
      ...match,
      divisionId,
      createdAt: serverTimestamp()
    });
  });

  // Mark division as generated
  const divRef = doc(db, "tournamentsV2", tournamentId, "divisions", divisionId);
  batch.update(divRef, { poolsGenerated: true, status: 'active' });

  await batch.commit();
}

export function subscribeToPools(tournamentId, callback) {
  const q = collection(db, "tournamentsV2", tournamentId, "pools");
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map(d => d.data()));
  });
}

export async function deletePoolsAndMatches(tournamentId, divisionId) {
  // Delete all pools and matches for a division
  const batch = writeBatch(db);
  
  const poolsQuery = query(collection(db, "tournamentsV2", tournamentId, "pools"), where("divisionId", "==", divisionId));
  const poolsSnap = await getDocs(poolsQuery);
  poolsSnap.forEach(d => batch.delete(d.ref));

  const matchesQuery = query(collection(db, "tournamentsV2", tournamentId, "matches"), where("divisionId", "==", divisionId));
  const matchesSnap = await getDocs(matchesQuery);
  matchesSnap.forEach(d => batch.delete(d.ref));

  // Reset division
  const divRef = doc(db, "tournamentsV2", tournamentId, "divisions", divisionId);
  batch.update(divRef, { poolsGenerated: false, status: 'draft' });

  await batch.commit();
}

// --- MATCHES ---

export function subscribeToMatchesV2(tournamentId, callback) {
  const q = collection(db, "tournamentsV2", tournamentId, "matches");
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map(d => d.data()));
  });
}

export async function updateMatchScore(tournamentId, matchId, data) {
  const ref = doc(db, "tournamentsV2", tournamentId, "matches", matchId);
  await updateDoc(ref, data);
}

// Update multiple matches (for bracket advancement)
export async function updateMatchesBatch(tournamentId, matchesUpdates) {
  const batch = writeBatch(db);
  matchesUpdates.forEach(update => {
    const ref = doc(db, "tournamentsV2", tournamentId, "matches", update.id);
    batch.update(ref, update.data);
  });
  await batch.commit();
}

// Update Pool Standings
export async function updatePoolStandings(tournamentId, poolId, standings) {
  const ref = doc(db, "tournamentsV2", tournamentId, "pools", poolId);
  await updateDoc(ref, { standings });
}
