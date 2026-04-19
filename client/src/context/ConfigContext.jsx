import { createContext, useContext, useState } from 'react';

const ConfigContext = createContext(null);

export function ConfigProvider({ children }) {
  const [configVersion, setConfigVersion] = useState(0);

  const notifyConfigSaved = () => setConfigVersion((v) => v + 1);

  return (
    <ConfigContext.Provider value={{ configVersion, notifyConfigSaved }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfigContext() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfigContext must be used within ConfigProvider');
  return ctx;
}
