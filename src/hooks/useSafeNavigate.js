import { useNavigate } from 'react-router-dom';
import { useNavigationBlocker } from '../contexts/NavigationBlockerContext';

/**
 * A custom navigation hook that replaces `useNavigate`.
 * It checks the global `isDirty` state before allowing programmatic navigation.
 */
export function useSafeNavigate() {
  const navigate = useNavigate();
  const context = useNavigationBlocker();

  const safeNavigate = (to, options) => {
    if (context && context.isDirty) {
      context.setPendingPath(to);
      context.setShowModal(true);
    } else {
      navigate(to, options);
    }
  };

  return safeNavigate;
}
