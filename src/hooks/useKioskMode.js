import { useEffect, useCallback } from 'react';

/**
 * Hook to manage Kiosk specific behaviors:
 * 1. Restrict text selection, touch actions (pinch-to-zoom), and scrolling.
 * 2. Idle timeout to reset the view after a specified duration of inactivity.
 * 3. Utility to enter fullscreen on first tap.
 *
 * @param {Function} onIdle - Callback executed when the idle timer expires.
 * @param {number} timeoutMs - Idle timeout in milliseconds (default: 60000ms / 60s).
 */
export function useKioskMode(onIdle, timeoutMs = 60000) {

  // Auto-reset / Idle timer logic
  const resetTimer = useCallback(() => {
    // We store the timer on the window object to avoid complex dependency cycles
    // and easily clear it across re-renders if necessary
    if (window.kioskTimeout) {
      clearTimeout(window.kioskTimeout);
    }
    window.kioskTimeout = setTimeout(() => {
      if (onIdle) onIdle();
    }, timeoutMs);
  }, [onIdle, timeoutMs]);

  useEffect(() => {
    // 1. Apply strict kiosk styles to body
    const originalStyle = {
      overflow: document.body.style.overflow,
      touchAction: document.body.style.touchAction,
      userSelect: document.body.style.userSelect,
      webkitUserSelect: document.body.style.webkitUserSelect
    };

    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none'; // prevents pinch zoom
    document.body.style.userSelect = 'none'; // prevents text selection
    document.body.style.webkitUserSelect = 'none';

    // 2. Setup Idle Event Listeners
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    
    const handleInteraction = () => {
      resetTimer();
    };

    events.forEach(event => {
      document.addEventListener(event, handleInteraction, { passive: true });
    });

    // Start timer initially
    resetTimer();

    return () => {
      // Cleanup styles
      document.body.style.overflow = originalStyle.overflow;
      document.body.style.touchAction = originalStyle.touchAction;
      document.body.style.userSelect = originalStyle.userSelect;
      document.body.style.webkitUserSelect = originalStyle.webkitUserSelect;

      // Cleanup listeners
      events.forEach(event => {
        document.removeEventListener(event, handleInteraction);
      });

      if (window.kioskTimeout) {
        clearTimeout(window.kioskTimeout);
      }
    };
  }, [resetTimer]);

  // Utility to request fullscreen
  const requestFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    }
  }, []);

  return { requestFullscreen };
}
