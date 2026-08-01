import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PlatformUser } from './types';

export interface PlatformContextValue {
  platformUser: PlatformUser | null;
  setPlatformUser: (user: PlatformUser | null) => void;
}

const PlatformContext = createContext<PlatformContextValue | undefined>(undefined);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [platformUser, setPlatformUser] = useState<PlatformUser | null>(null);
  const value = useMemo(() => ({ platformUser, setPlatformUser }), [platformUser]);
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform() {
  const context = useContext(PlatformContext);
  if (!context) throw new Error('usePlatform must be used within PlatformProvider.');
  return context;
}
