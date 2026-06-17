import React, { useState } from 'react';
import { Download, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { generateExcel } from '../../utils/export/ExcelTemplateGenerator';
import { getSchema } from '../../utils/export/SchemaRegistry';

/**
 * A reusable, framework-agnostic (React) button for Excel exports.
 * 
 * @param {Object} props
 * @param {string} props.pageTitle - Title of the page/report.
 * @param {Array|Function} props.exportData - Array of objects or a function returning a Promise that resolves to an array.
 * @param {string} props.schemaKey - Key mapping to SchemaRegistry for columns.
 * @param {Array} props.columns - Explicit array of columns (overrides schemaKey).
 * @param {string} props.filename - Optional custom filename.
 * @param {Object} props.options - Optional generator settings (includeHeader, etc.).
 * @param {string} props.className - Additional tailwind classes.
 */
const ExportButton = ({
  pageTitle,
  exportData,
  schemaKey,
  columns,
  filename,
  options = {},
  className = ''
}) => {
  const [status, setStatus] = useState('idle'); // idle, loading, success, error
  const [errorMessage, setErrorMessage] = useState('');

  const handleExport = async () => {
    try {
      setStatus('loading');
      setErrorMessage('');

      // 1. Resolve columns
      const cols = columns || getSchema(schemaKey);
      if (!cols || cols.length === 0) {
        throw new Error('No columns defined for export.');
      }

      // 2. Fetch or resolve data
      let dataToExport = [];
      if (typeof exportData === 'function') {
        dataToExport = await exportData();
      } else if (Array.isArray(exportData)) {
        dataToExport = exportData;
      }

      if (!dataToExport || dataToExport.length === 0) {
        throw new Error('No data available to export.');
      }

      // 3. Generate Excel
      await generateExcel(dataToExport, cols, pageTitle, filename, options);

      setStatus('success');
      
      // Reset success state after 3 seconds
      setTimeout(() => {
        setStatus('idle');
      }, 3000);

    } catch (error) {
      console.error('Export Error:', error);
      setErrorMessage(error.message || 'Failed to export');
      setStatus('error');
      
      // Reset error state after 5 seconds
      setTimeout(() => {
        setStatus('idle');
        setErrorMessage('');
      }, 5000);
    }
  };

  // UI mapping for states
  const getButtonContent = () => {
    switch (status) {
      case 'loading':
        return (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Exporting...
          </>
        );
      case 'success':
        return (
          <>
            <CheckCircle className="w-4 h-4 mr-2 text-green-400" />
            Exported!
          </>
        );
      case 'error':
        return (
          <>
            <AlertCircle className="w-4 h-4 mr-2 text-red-400" />
            {errorMessage || 'Error'}
          </>
        );
      case 'idle':
      default:
        return (
          <>
            <Download className="w-4 h-4 mr-2" />
            Export Excel
          </>
        );
    }
  };

  // Dark Dashboard Theme classes
  const baseClasses = "inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900";
  
  const getStatusClasses = () => {
    switch (status) {
      case 'loading':
        return "bg-slate-700 text-slate-300 cursor-not-allowed";
      case 'success':
        return "bg-green-600/20 text-green-400 border border-green-500/30";
      case 'error':
        return "bg-red-600/20 text-red-400 border border-red-500/30";
      case 'idle':
      default:
        return "bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-600/50 hover:border-slate-500 hover:shadow-lg hover:shadow-slate-900/20 focus:ring-slate-500";
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={status === 'loading'}
      className={`${baseClasses} ${getStatusClasses()} ${className}`}
      title={errorMessage || "Export to Excel"}
    >
      {getButtonContent()}
    </button>
  );
};

export default ExportButton;
