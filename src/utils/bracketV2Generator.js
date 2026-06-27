// src/utils/bracketV2Generator.js

/**
 * Given an array of advancing teams (already ordered by seeding),
 * generates a single-elimination bracket for the Medal Round.
 * 
 * Seeding array length doesn't have to be a power of 2. 
 * Dummy 'BYE' teams will be inserted.
 */
export function generateMedalBracket(teams, divisionId) {
  // Find nearest power of 2
  let size = 2;
  while (size < teams.length) size *= 2;

  // Standard seeding order for powers of 2
  const getSeedingOrder = (n) => {
    if (n === 2) return [0, 1];
    if (n === 4) return [0, 3, 1, 2];
    if (n === 8) return [0, 7, 3, 4, 1, 6, 2, 5];
    if (n === 16) return [0, 15, 7, 8, 3, 12, 4, 11, 1, 14, 6, 9, 2, 13, 5, 10];
    // Fallback: simple pairs
    const order = [];
    for (let i = 0; i < n / 2; i++) {
      order.push(i, n - 1 - i);
    }
    return order;
  };

  const seedOrder = getSeedingOrder(size);
  const initialMatches = [];
  
  // Create Round 1
  for (let i = 0; i < size; i += 2) {
    const t1Idx = seedOrder[i];
    const t2Idx = seedOrder[i + 1];
    
    const team1 = t1Idx < teams.length ? teams[t1Idx] : { id: 'bye', name: 'BYE' };
    const team2 = t2Idx < teams.length ? teams[t2Idx] : { id: 'bye', name: 'BYE' };
    
    let winnerId = null;
    let status = 'scheduled';

    if (team1.id === 'bye' && team2.id !== 'bye') {
      winnerId = team2.id;
      status = 'completed';
    } else if (team2.id === 'bye' && team1.id !== 'bye') {
      winnerId = team1.id;
      status = 'completed';
    } else if (team1.id === 'bye' && team2.id === 'bye') {
      winnerId = 'bye';
      status = 'completed';
    }

    initialMatches.push({
      id: `m-r1-${Date.now()}-${i}`,
      divisionId,
      poolId: null, // Medal round
      round: size === 2 ? 'Final' : size === 4 ? 'Semifinal' : size === 8 ? 'Quarterfinal' : 'Round 1',
      roundNum: 1,
      matchNum: i / 2,
      team1Id: team1.id,
      team1Name: team1.name,
      team2Id: team2.id,
      team2Name: team2.name,
      score1: 0,
      score2: 0,
      winnerId,
      status,
      court: '',
      time: null,
      nextMatchId: null // to be linked
    });
  }

  const allMatches = [...initialMatches];
  let currentRoundMatches = initialMatches;
  let roundNum = 2;
  let currentSize = size / 2;

  // Build subsequent rounds
  while (currentSize > 1) {
    const nextRoundMatches = [];
    const roundName = currentSize === 2 ? 'Final' : currentSize === 4 ? 'Semifinal' : `Round ${roundNum}`;

    for (let i = 0; i < currentSize; i += 2) {
      const match = {
        id: `m-r${roundNum}-${Date.now()}-${i}`,
        divisionId,
        poolId: null,
        round: roundName,
        roundNum,
        matchNum: i / 2,
        team1Id: null,
        team1Name: 'TBD',
        team2Id: null,
        team2Name: 'TBD',
        score1: 0,
        score2: 0,
        winnerId: null,
        status: 'scheduled',
        court: '',
        time: null,
        nextMatchId: null
      };

      // Link previous round to this match
      currentRoundMatches[i].nextMatchId = match.id;
      currentRoundMatches[i + 1].nextMatchId = match.id;

      // Auto-advance byes if possible
      if (currentRoundMatches[i].winnerId && currentRoundMatches[i].winnerId !== 'bye') {
        match.team1Id = currentRoundMatches[i].winnerId;
        match.team1Name = currentRoundMatches[i].winnerId; // we need names in a real scenario, but TBD is ok, will update on match resolve
      }
      if (currentRoundMatches[i + 1].winnerId && currentRoundMatches[i + 1].winnerId !== 'bye') {
        match.team2Id = currentRoundMatches[i + 1].winnerId;
        match.team2Name = currentRoundMatches[i + 1].winnerId;
      }

      nextRoundMatches.push(match);
      allMatches.push(match);
    }

    currentRoundMatches = nextRoundMatches;
    currentSize /= 2;
    roundNum++;
  }

  return allMatches;
}
