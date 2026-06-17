import React from 'react';
import ExportButton from '../components/export/ExportButton';

/**
 * Example Page Integration: My Bookings
 */
export const MyBookingsExample = () => {
  // Mock Data
  const getBookingsData = async () => {
    // Simulating API call
    return new Promise(resolve => setTimeout(() => resolve([
      { bookingId: 'B-1001', court: 'Court A', date: '2026-06-15T00:00:00Z', timeSlot: '10:00 AM - 11:00 AM', playerName: 'John Doe', status: 'Confirmed', amount: 25.00, paymentMethod: 'Credit Card', notes: 'First-time player' },
      { bookingId: 'B-1002', court: 'Court B', date: '2026-06-16T00:00:00Z', timeSlot: '02:00 PM - 04:00 PM', playerName: 'Jane Smith', status: 'Pending', amount: 50.00, paymentMethod: 'PayPal', notes: '' },
      { bookingId: 'B-1003', court: 'Court A', date: '2026-06-17T00:00:00Z', timeSlot: '06:00 PM - 07:00 PM', playerName: 'Mike Johnson', status: 'Cancelled', amount: 25.00, paymentMethod: 'Cash', notes: 'Rain check' }
    ]), 1000));
  };

  return (
    <div className="p-6 bg-slate-900 text-white rounded-lg shadow-md mb-6 border border-slate-800">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">My Bookings</h2>
        <ExportButton 
          pageTitle="My Bookings"
          schemaKey="MY_BOOKINGS"
          exportData={getBookingsData}
          filename="My_Bookings_Report"
        />
      </div>
      <p className="text-slate-400 text-sm">Example showing async data fetching on click.</p>
    </div>
  );
};

/**
 * Example Page Integration: Courts Management
 */
export const CourtsExample = () => {
  // Static data example
  const courtsData = [
    { courtId: 'C-01', name: 'Championship Court 1', type: 'Indoor', capacity: 4, hourlyRate: 40.00, status: 'Active', maintenanceSchedule: 'Mon 6AM-8AM' },
    { courtId: 'C-02', name: 'Championship Court 2', type: 'Indoor', capacity: 4, hourlyRate: 40.00, status: 'Under Maintenance', maintenanceSchedule: 'Tue 6AM-12PM' },
    { courtId: 'C-03', name: 'Outdoor Court A', type: 'Outdoor', capacity: 4, hourlyRate: 20.00, status: 'Active', maintenanceSchedule: 'Wed 8PM-10PM' }
  ];

  return (
    <div className="p-6 bg-slate-900 text-white rounded-lg shadow-md mb-6 border border-slate-800">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Courts Inventory</h2>
        <ExportButton 
          pageTitle="Courts Inventory"
          schemaKey="COURTS"
          exportData={courtsData}
          filename="Courts_Status"
        />
      </div>
      <p className="text-slate-400 text-sm">Example showing static array data passing.</p>
    </div>
  );
};

/**
 * Example Page Integration: Revenue Report
 */
export const RevenueExample = () => {
  const revenueData = [
    { date: '2026-06-01T00:00:00Z', source: 'Court Rentals', amount: 1500.00, tax: 105.00, net: 1395.00, paymentMethod: 'Mixed', reference: 'INV-260601' },
    { date: '2026-06-02T00:00:00Z', source: 'Pro Shop', amount: 450.00, tax: 31.50, net: 418.50, paymentMethod: 'Credit Card', reference: 'POS-021' },
    { date: '2026-06-03T00:00:00Z', source: 'Tournament Fees', amount: 3200.00, tax: 224.00, net: 2976.00, paymentMethod: 'Bank Transfer', reference: 'TRN-001' }
  ];

  return (
    <div className="p-6 bg-slate-900 text-white rounded-lg shadow-md mb-6 border border-slate-800">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Revenue Analytics</h2>
        <ExportButton 
          pageTitle="Revenue Report"
          schemaKey="REVENUE"
          exportData={revenueData}
          options={{ facilityName: 'Downtown Club', userName: 'Finance Admin' }}
        />
      </div>
      <p className="text-slate-400 text-sm">Example showing custom options (facilityName, userName) injected into the footer/header.</p>
    </div>
  );
};

/**
 * Combined View for demonstration
 */
const ExportExamples = () => {
  return (
    <div className="p-8 min-h-screen bg-black">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Export System Integration Examples</h1>
        <MyBookingsExample />
        <CourtsExample />
        <RevenueExample />
      </div>
    </div>
  );
};

export default ExportExamples;
