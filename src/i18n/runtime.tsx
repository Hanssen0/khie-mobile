import { useLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  languageOptions,
  resolveDeviceLocale,
  type AppLocale,
  type LocalePreference,
} from "./locale";

export function createI18nRuntime<TranslationKey extends string>(
  messages: Record<AppLocale, Record<TranslationKey, string>>,
  fallback: Record<TranslationKey, string>,
) {
  type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;
  type ContextValue = {
    locale: AppLocale;
    preference: LocalePreference;
    setPreference: (preference: LocalePreference) => void;
    t: Translate;
  };

  const preferenceKey = "khie.locale.preference.v1";
  const context = createContext<ContextValue | undefined>(undefined);

  function isPreference(value: string | null): value is LocalePreference {
    return value === "system" || languageOptions.some((option) => option.value === value);
  }

  function I18nProvider({ children }: { children: ReactNode }) {
    const locales = useLocales();
    const [preference, setPreferenceState] = useState<LocalePreference>("system");
    const detectedLocale = resolveDeviceLocale(locales[0]?.languageTag, locales[0]?.languageCode);
    const locale = preference === "system" ? detectedLocale : preference;

    useEffect(() => {
      void SecureStore.getItemAsync(preferenceKey)
        .then((saved) => { if (isPreference(saved)) setPreferenceState(saved); })
        .catch(() => undefined);
    }, []);

    const setPreference = useCallback((next: LocalePreference) => {
      setPreferenceState(next);
      void SecureStore.setItemAsync(preferenceKey, next).catch(() => undefined);
    }, []);

    const t = useCallback<Translate>((key, values) => {
      let value = messages[locale][key] ?? fallback[key] ?? key;
      for (const [name, replacement] of Object.entries(values ?? {})) {
        value = value.replaceAll(`{${name}}`, String(replacement));
      }
      return value;
    }, [locale]);

    const value = useMemo(() => ({ locale, preference, setPreference, t }), [locale, preference, setPreference, t]);
    return <context.Provider value={value}>{children}</context.Provider>;
  }

  function useI18n(): ContextValue {
    const value = useContext(context);
    if (!value) throw new Error("useI18n must be used inside I18nProvider");
    return value;
  }

  function languageLabel(preference: LocalePreference, t: Translate): string {
    if (preference === "system") return t("followSystem" as TranslationKey);
    return languageOptions.find((option) => option.value === preference)?.label ?? preference;
  }

  return { I18nProvider, useI18n, languageLabel };
}
