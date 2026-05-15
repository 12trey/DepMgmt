// For intercomponent package create/change/delete notifications
import { createContext, useContext, useState } from 'react';

export const PackageChangeContext = createContext(null);

export function PackageChangeProvider({ children }) {
  const [changedPackage, setChangedPackage] = useState(null);

  return (
    <PackageChangeContext.Provider value={{ changedPackage, setChangedPackage }}>
      {children}
    </PackageChangeContext.Provider>
  );
}

export function usePackageChange() {
  return useContext(PackageChangeContext);
}