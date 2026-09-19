import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const DEVELOPER_MODE_KEY = "khie.developer-mode.v1";

type DeveloperModeContextValue = { developerMode: boolean; setDeveloperMode: (enabled: boolean) => void };

const DeveloperModeContext = createContext<DeveloperModeContextValue | undefined>(undefined);

export function DeveloperModeProvider({ children }: { children: ReactNode }) {
  const [developerMode, setDeveloperModeState] = useState(false);
  useEffect(() => {
    void SecureStore.getItemAsync(DEVELOPER_MODE_KEY).then((saved) => { if (saved === "on") setDeveloperModeState(true); }).catch(() => undefined);
  }, []);
  const setDeveloperMode = useCallback((enabled: boolean) => {
    setDeveloperModeState(enabled);
    void SecureStore.setItemAsync(DEVELOPER_MODE_KEY, enabled ? "on" : "off").catch(() => undefined);
  }, []);
  const value = useMemo(() => ({ developerMode, setDeveloperMode }), [developerMode, setDeveloperMode]);
  return <DeveloperModeContext.Provider value={value}>{children}</DeveloperModeContext.Provider>;
}

export function useDeveloperMode(): DeveloperModeContextValue {
  const value = useContext(DeveloperModeContext);
  if (!value) throw new Error("useDeveloperMode must be used inside DeveloperModeProvider");
  return value;
}
