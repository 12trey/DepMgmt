import { createContext, useContext, useState } from 'react';

const AdCredentialContext = createContext(null);

export function AdCredentialProvider({ children }) {
  const [adUsername, setAdUsername] = useState('');
  const [adPassword, setAdPassword] = useState('');

  const clear = () => {
    setAdUsername('');
    setAdPassword('');
  };

  return (
    <AdCredentialContext.Provider value={{ adUsername, setAdUsername, adPassword, setAdPassword, clear }}>
      {children}
    </AdCredentialContext.Provider>
  );
}

export function useAdCredential() {
  const ctx = useContext(AdCredentialContext);
  if (!ctx) throw new Error('useAdCredential must be used within AdCredentialProvider');
  return ctx;
}
