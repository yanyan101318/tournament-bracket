const admin = require('firebase-admin');

// IMPORTANT: Set the path to your Firebase Service Account Key JSON file
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account-key.json';

try {
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  console.error("Failed to initialize Firebase Admin. Make sure you have downloaded a service account key and placed it at './service-account-key.json' or set GOOGLE_APPLICATION_CREDENTIALS.");
  console.error(error.message);
  process.exit(1);
}

const db = admin.firestore();

async function backfillCourtOrdersUserId() {
  console.log("Starting backfill for courtOrders...");
  
  try {
    // 1. Query courtOrders
    // We fetch all orders, but we can filter those missing userId in code
    // (Firestore doesn't natively support querying for "missing" fields efficiently without complex setups)
    const courtOrdersRef = db.collection('courtOrders');
    const snapshot = await courtOrdersRef.get();
    
    if (snapshot.empty) {
      console.log('No courtOrders found.');
      return;
    }

    console.log(`Found ${snapshot.size} total court orders.`);

    let updatedCount = 0;
    let missingBookingIdCount = 0;
    let noBookingFoundCount = 0;
    let alreadyHasUserIdCount = 0;

    // Process in batches
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      
      // If it already has a userId, skip
      if (data.userId !== undefined && data.userId !== null) {
        alreadyHasUserIdCount++;
        continue;
      }

      const bookingId = data.bookingId;
      if (!bookingId) {
        console.warn(`Order ${doc.id} has no bookingId. Skipping.`);
        missingBookingIdCount++;
        continue;
      }

      // 2. Fetch linked booking
      const bookingDoc = await db.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) {
        console.warn(`Order ${doc.id} references booking ${bookingId} which does not exist. Skipping.`);
        noBookingFoundCount++;
        continue;
      }

      const bookingData = bookingDoc.data();
      const userId = bookingData.userId || null;

      // 3. Update courtOrder with userId
      batch.update(courtOrdersRef.doc(doc.id), { userId: userId });
      updatedCount++;
      batchCount++;

      // Commit every 500 operations
      if (batchCount === 500) {
        console.log(`Committing batch of ${batchCount} updates...`);
        await batch.commit();
        batch = db.batch(); // Reset batch
        batchCount = 0;
      }
    }

    // Commit any remaining updates
    if (batchCount > 0) {
      console.log(`Committing final batch of ${batchCount} updates...`);
      await batch.commit();
    }

    console.log("=== Backfill Complete ===");
    console.log(`Total orders processed: ${snapshot.size}`);
    console.log(`Already had userId: ${alreadyHasUserIdCount}`);
    console.log(`Missing bookingId: ${missingBookingIdCount}`);
    console.log(`Booking not found: ${noBookingFoundCount}`);
    console.log(`Successfully updated: ${updatedCount}`);
    
  } catch (error) {
    console.error("Error during backfill:", error);
  }
}

backfillCourtOrdersUserId();
