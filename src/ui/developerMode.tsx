import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const SIMPLE_MODE_KEY = "khie.simple-mode.v1";

type DeveloperModeContextValue = { developerMode: boolean; setDeveloperMode: (enabled: boolean) => void };

const DeveloperModeContext = createContext<DeveloperModeContextValue | undefined>(undefined);

export function DeveloperModeProvider({ children }: { children: ReactNode }) {
  const [simpleMode, setSimpleModeState] = useState(true);
  useEffect(() => {
    void SecureStore.getItemAsync(SIMPLE_MODE_KEY).then((saved) => { if (saved === "off") setSimpleModeState(false); }).catch(() => undefined);
  }, []);
  const setDeveloperMode = useCallback((enabled: boolean) => {
    setSimpleModeState(!enabled);
    void SecureStore.setItemAsync(SIMPLE_MODE_KEY, enabled ? "off" : "on").catch(() => undefined);
  }, []);
  const developerMode = !simpleMode;
  const value = useMemo(() => ({ developerMode, setDeveloperMode }), [developerMode, setDeveloperMode]);
  return <DeveloperModeContext.Provider value={value}>{children}</DeveloperModeContext.Provider>;
}

export function useDeveloperMode(): DeveloperModeContextValue {
  const value = useContext(DeveloperModeContext);
  if (!value) throw new Error("useDeveloperMode must be used inside DeveloperModeProvider");
  return value;
}
