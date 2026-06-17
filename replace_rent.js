const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'admin', 'InventoryPage.jsx');
let content = fs.readFileSync(filePath, 'utf8');

// Replacements
const replacements = [
  // Helpers
  [/filterBorrowsByBorrowedAtRange/g, 'filterRentsByRentedAtRange'],
  [/aggregateMostBorrowed/g, 'aggregateMostRented'],
  [/isBorrowRecordActive/g, 'isRentRecordActive'],
  [/getBorrowScheduledRentalCharge/g, 'getRentScheduledRentalCharge'],
  [/getBorrowBillableRentalHours/g, 'getRentBillableRentalHours'],
  [/getBorrowRentalCaption/g, 'getRentRentalCaption'],

  // React state and local vars
  [/\bborrowHours\b/g, 'rentHours'],
  [/\bsetBorrowHours\b/g, 'setRentHours'],
  [/\bborrowLines\b/g, 'rentLines'],
  [/\bsetBorrowLines\b/g, 'setRentLines'],
  [/\bborrowerName\b/g, 'renterName'],
  [/\bsetBorrowerName\b/g, 'setRenterName'],
  [/\bdashBorrowPage\b/g, 'dashRentPage'],
  [/\bsetDashBorrowPage\b/g, 'setDashRentPage'],
  [/\bactiveBorrowPage\b/g, 'activeRentPage'],
  [/\bsetActiveBorrowPage\b/g, 'setActiveRentPage'],
  [/\bborrows\b/g, 'rents'],
  [/\bsetBorrows\b/g, 'setRents'],
  [/\bborrow\b/g, 'rent'],
  [/\bBorrowRentalCell\b/g, 'RentRentalCell'],
  [/\bBorrowBillableHoursCell\b/g, 'RentBillableHoursCell'],
  [/\bborrowPreviewLines\b/g, 'rentPreviewLines'],

  // UI Text
  [/Most Borrowed/g, 'Most Rented'],
  [/Borrowing/g, 'Renting'],
  [/Borrowed At/g, 'Rented At'],
  [/Borrow recorded/g, 'Rent recorded'],
  [/Borrowing time extended/g, 'Renting time extended'],
  [/>Borrow</g, '>Rent<'],
  [/>Borrowing</g, '>Renting<'],
  [/Record Borrow/g, 'Record Rent'],
  [/New Borrow/g, 'New Rent'],
  [/Active Borrows/g, 'Active Rents'],
  [/Borrow History/g, 'Rent History'],
  [/No active borrows/g, 'No active rents'],
  [/No borrow history/g, 'No rent history'],
  [/Recent Borrows/g, 'Recent Rents'],
  [/Total Borrows/g, 'Total Rents'],
  [/\(Borrower name\)/g, '(Renter name)'],
  [/\bborrowing time\b/g, 'renting time'],
];

for (const [pattern, replacement] of replacements) {
  content = content.replace(pattern, replacement);
}

// Map back DB fields if they got changed by accident
// DB expects 'borrowRecords'
content = content.replace(/collection\(db,\s*"rentRecords"\)/g, 'collection(db, "borrowRecords")');
content = content.replace(/orderBy\("rentedAt"/g, 'orderBy("borrowedAt"');
// DB payload expecting 'borrowerName', 'borrowedAt'
content = content.replace(/renterName:\s*renterName\.trim\(\)/g, 'borrowerName: renterName.trim()');
// Actually, it might be `{ renterName: renterName.trim() }`
content = content.replace(/renterName:\s*renterName/g, 'borrowerName: renterName');
content = content.replace(/rentedAt:\s*serverTimestamp/g, 'borrowedAt: serverTimestamp');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Replaced successfully.');
