// src/utils/poolGenerator.js

/**
 * Helper to shuffle an array (Fisher-Yates)
 */
export function shuffleArray(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Distribute teams into pools using snake seeding.
 * If teams don't have a seed, they are randomized first.
 */
export function generatePools(teams, numPools) {
  // Sort teams. If no seed, randomize.
  const seededTeams = [...teams].sort((a, b) => {
    if (a.seed && b.seed) return a.seed - b.seed;
    if (a.seed) return -1;
    if (b.seed) return 1;
    return Math.random() - 0.5; // Randomize unseeded
  });

  const pools = Array.from({ length: numPools }, (_, i) => ({
    id: `pool-${Date.now()}-${i}`,
    name: `Pool ${String.fromCharCode(65 + i)}`,
    teamIds: [],
    teams: [], // We'll keep full objects temporarily for generation
    standings: []
  }));

  let direction = 1; // 1 for left-to-right, -1 for right-to-left
  let currentPoolIndex = 0;

  for (let i = 0; i < seededTeams.length; i++) {
    pools[currentPoolIndex].teamIds.push(seededTeams[i].id);
    pools[currentPoolIndex].teams.push(seededTeams[i]);
    
    // Initialize standings
    pools[currentPoolIndex].standings.push({
      teamId: seededTeams[i].id,
      name: seededTeams[i].name,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0
    });

    currentPoolIndex += direction;

    if (currentPoolIndex >= numPools) {
      direction = -1;
      currentPoolIndex = numPools - 1;
    } else if (currentPoolIndex < 0) {
      direction = 1;
      currentPoolIndex = 0;
    }
  }

  return pools;
}

/**
 * Generate Round Robin matches for a single pool.
 * Uses the circle method.
 */
export function generateRoundRobinMatches(pool) {
  const teams = [...pool.teams];
  if (teams.length < 2) return [];

  // If odd number of teams, add a dummy 'bye' team
  const hasBye = teams.length % 2 !== 0;
  if (hasBye) {
    teams.push({ id: 'bye', name: 'BYE' });
  }

  const numTeams = teams.length;
  const numRounds = numTeams - 1;
  const matchesPerRound = numTeams / 2;
  const matches = [];

  // Arrays to rotate
  const currentTeams = [...teams];

  for (let round = 0; round < numRounds; round++) {
    for (let match = 0; match < matchesPerRound; match++) {
      const home = currentTeams[match];
      const away = currentTeams[numTeams - 1 - match];

      // Skip if it's a bye match
      if (home.id !== 'bye' && away.id !== 'bye') {
        matches.push({
          id: `m-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          poolId: pool.id,
          round: `Pool Play`,
          team1Id: home.id,
          team1Name: home.name,
          team2Id: away.id,
          team2Name: away.name,
          score1: 0,
          score2: 0,
          winnerId: null,
          status: 'scheduled',
          court: '',
          time: null
        });
      }
    }

    // Rotate teams (keep the first team fixed, rotate the rest clockwise)
    const lastTeam = currentTeams.pop();
    currentTeams.splice(1, 0, lastTeam);
  }

  return matches;
}

/**
 * High-level function to take a list of teams and desired pools,
 * and return the generated Pools and Matches.
 */
export function createPoolsAndMatches(teams, desiredNumPools) {
  const numPools = Math.min(desiredNumPools, Math.floor(teams.length / 2));
  if (numPools < 1) return { pools: [], matches: [] };

  const pools = generatePools(teams, numPools);
  let allMatches = [];

  for (const pool of pools) {
    const poolMatches = generateRoundRobinMatches(pool);
    allMatches = [...allMatches, ...poolMatches];
    
    // Clean up temporary full team objects
    delete pool.teams;
  }

  return { pools, matches: allMatches };
}

/**
 * Calculate Standings for a pool given its matches
 */
export function calculateStandings(pool, matches) {
  const standingsMap = {};

  // Initialize
  pool.teamIds.forEach(tId => {
    const existing = (pool.standings || []).find(s => s.teamId === tId);
    standingsMap[tId] = {
      teamId: tId,
      name: existing ? existing.name : "Team",
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0
    };
  });

  matches.forEach(m => {
    if (m.poolId !== pool.id || m.status !== 'completed' || !m.winnerId) return;

    const t1 = m.team1Id;
    const t2 = m.team2Id;

    if (!standingsMap[t1] || !standingsMap[t2]) return;

    standingsMap[t1].pointsFor += m.score1;
    standingsMap[t1].pointsAgainst += m.score2;
    standingsMap[t2].pointsFor += m.score2;
    standingsMap[t2].pointsAgainst += m.score1;

    if (m.winnerId === t1) {
      standingsMap[t1].wins += 1;
      standingsMap[t2].losses += 1;
    } else if (m.winnerId === t2) {
      standingsMap[t2].wins += 1;
      standingsMap[t1].losses += 1;
    }
  });

  // Calculate differentials
  Object.values(standingsMap).forEach(s => {
    s.pointDifferential = s.pointsFor - s.pointsAgainst;
  });

  // Sort: Wins -> Point Diff -> Points For
  return Object.values(standingsMap).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointDifferential !== a.pointDifferential) return b.pointDifferential - a.pointDifferential;
    return b.pointsFor - a.pointsFor;
  });
}
