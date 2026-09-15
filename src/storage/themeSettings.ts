import * as SecureStore from "expo-secure-store";

const THEME_PREFERENCE_KEY = "khie.theme.preference.v1";

export type ThemePreference = "system" | "light" | "dark";

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export class SecureStoreThemeSettings {
  async load(): Promise<ThemePreference> {
    const value = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
    return isThemePreference(value) ? value : "system";
  }

  async save(preference: ThemePreference): Promise<ThemePreference> {
    await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, preference);
    return preference;
  }
}
