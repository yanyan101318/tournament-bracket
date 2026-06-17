import { useEffect, useCallback } from 'react';
import { useNavigationBlocker } from '../contexts/NavigationBlockerContext';

/**
 * A custom hook to manage the dirty state of a page/form.
 * When isDirty is true, the user will be warned before navigating away or closing the tab.
 * 
 * @param {boolean} initialState - Initial dirty state (default: false)
 * @returns {Object} { isDirty, setIsDirty, markClean, markDirty }
 */
export function useUnsavedChanges(initialState = false) {
  const context = useNavigationBlocker();

  // Call hooks unconditionally
  const rawIsDirty = context?.isDirty;
  const rawSetIsDirty = context?.setIsDirty;

  const isDirty = rawIsDirty ?? false;
  
  // Set initial state if needed
  useEffect(() => {
    if (initialState && rawSetIsDirty) {
      rawSetIsDirty(true);
    }
    
    // Auto-clean up when the component unmounts
    return () => {
      if (rawSetIsDirty) {
        rawSetIsDirty(false);
      }
    };
  }, [initialState, rawSetIsDirty]);

  const markClean = useCallback(() => {
    if (rawSetIsDirty) rawSetIsDirty(false);
  }, [rawSetIsDirty]);
  
  const markDirty = useCallback(() => {
    if (rawSetIsDirty) rawSetIsDirty(true);
  }, [rawSetIsDirty]);

  if (!context) {
    console.warn("useUnsavedChanges must be used within a NavigationBlockerProvider");
    return {
      isDirty: false,
      setIsDirty: () => {},
      markClean: () => {},
      markDirty: () => {}
    };
  }

  return {
    isDirty,
    setIsDirty: rawSetIsDirty,
    markClean,
    markDirty
  };
}
