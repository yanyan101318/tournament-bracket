import React, { createContext, useContext, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const NavigationBlockerContext = createContext();

export const useNavigationBlocker = () => useContext(NavigationBlockerContext);

export const NavigationBlockerProvider = ({ children }) => {
  const location = useLocation();

  // 1. Native Browser Protection (Tab Close / Refresh / External Link Clicks)
  useEffect(() => {
    // Disable this protection completely on the kiosk page so users 
    // can click the external 'Sign Up / Login' link without a warning
    if (location.pathname === '/kiosk') {
      return;
    }

    const handleBeforeUnload = (event) => {
      // The user requested that the system ALWAYS protects against tab closures
      // across all admin pages.
      event.preventDefault();
      event.returnValue = ''; 
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [location.pathname]);

  return (
    <NavigationBlockerContext.Provider value={{}}>
      {children}
    </NavigationBlockerContext.Provider>
  );
};
