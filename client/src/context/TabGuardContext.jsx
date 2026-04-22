import { createContext, useContext, useEffect, useRef } from 'react';

// Pages register a guard function that returns true when the tab has unsaved state.
// App.jsx calls canClose(path) before removing a tab from openTabs.
export const TabGuardContext = createContext(null);

export function useTabGuard(path, isDirtyFn) {
  const register = useContext(TabGuardContext);
  // Keep a ref so the registered callback always reads the latest value
  // without needing to re-register on every render.
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = isDirtyFn(); });

  useEffect(() => {
    if (!register) return;
    return register(path, () => dirtyRef.current);
  }, [path, register]);
}
