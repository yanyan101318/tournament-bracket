/**
 * SchemaRegistry.js
 * 
 * Centralized configuration registry for defining Excel export columns across different pages.
 * Easily extensible for new pages.
 */

export const FORMATS = {
  DATE: 'date',
  CURRENCY: 'currency',
  PERCENT: 'percent',
  TEXT: 'text'
};

export const EXPORT_SCHEMAS = {
  MY_BOOKINGS: [
    { key: 'bookingId', label: 'Booking ID', width: 20 },
    { key: 'court', label: 'Court', width: 25 },
    { key: 'date', label: 'Date', width: 15, format: FORMATS.DATE },
    { key: 'timeSlot', label: 'Time Slot', width: 20 },
    { key: 'playerName', label: 'Player Name', width: 30 },
    { key: 'status', label: 'Status', width: 15 },
    { key: 'amount', label: 'Amount', width: 15, format: FORMATS.CURRENCY },
    { key: 'paymentMethod', label: 'Payment Method', width: 20 },
    { key: 'notes', label: 'Notes', width: 40 }
  ],
  COURTS: [
    { key: 'courtId', label: 'Court ID', width: 20 },
    { key: 'name', label: 'Name', width: 30 },
    { key: 'type', label: 'Type', width: 20 },
    { key: 'capacity', label: 'Capacity', width: 15 },
    { key: 'hourlyRate', label: 'Hourly Rate', width: 15, format: FORMATS.CURRENCY },
    { key: 'status', label: 'Status', width: 15 },
    { key: 'maintenanceSchedule', label: 'Maintenance Schedule', width: 30 }
  ],
  SCHEDULE: [
    { key: 'date', label: 'Date', width: 15, format: FORMATS.DATE },
    { key: 'court', label: 'Court', width: 25 },
    { key: 'time', label: 'Time', width: 15 },
    { key: 'event', label: 'Event', width: 35 },
    { key: 'organizer', label: 'Organizer', width: 25 },
    { key: 'attendees', label: 'Attendees', width: 15 },
    { key: 'status', label: 'Status', width: 15 }
  ],
  REVENUE: [
    { key: 'date', label: 'Date', width: 15, format: FORMATS.DATE },
    { key: 'source', label: 'Source', width: 25 },
    { key: 'amount', label: 'Amount', width: 15, format: FORMATS.CURRENCY },
    { key: 'tax', label: 'Tax', width: 15, format: FORMATS.CURRENCY },
    { key: 'net', label: 'Net', width: 15, format: FORMATS.CURRENCY },
    { key: 'paymentMethod', label: 'Payment Method', width: 20 },
    { key: 'reference', label: 'Reference', width: 25 }
  ],
  SALES_HISTORY: [
    { key: 'date', label: 'Date / Time', width: 25 },
    { key: 'orderId', label: 'Transaction ID', width: 20 },
    { key: 'source', label: 'Source', width: 15 },
    { key: 'customerName', label: 'Customer', width: 25 },
    { key: 'vendorName', label: 'Vendor', width: 25 },
    { key: 'summary', label: 'Items', width: 40 },
    { key: 'total', label: 'Total', width: 15, format: FORMATS.CURRENCY },
    { key: 'paymentMethod', label: 'Payment Method', width: 20 }
  ]
};

/**
 * Retrieves the column schema for a given key.
 * @param {string} schemaKey - The key corresponding to a schema in EXPORT_SCHEMAS.
 * @returns {Array} Array of column definitions.
 */
export const getSchema = (schemaKey) => {
  return EXPORT_SCHEMAS[schemaKey] || [];
};
