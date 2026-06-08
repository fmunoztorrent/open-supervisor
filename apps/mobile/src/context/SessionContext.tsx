import React, { createContext, useContext } from 'react';

interface Session {
  storeId: string;
  supervisorId: string;
  displayName: string;
}

const SessionContext = createContext<Session>({
  storeId: 'store-1',
  supervisorId: 'supervisor-1',
  displayName: 'Supervisor',
});

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <SessionContext.Provider value={{ storeId: 'store-1', supervisorId: 'supervisor-1', displayName: 'Supervisor' }}>
    {children}
  </SessionContext.Provider>
);

export const useSession = () => useContext(SessionContext);
