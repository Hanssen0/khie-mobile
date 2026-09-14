export type AppLocale = "en" | "zh-Hans" | "zh-Hant" | "hak";
export type LocalePreference = "system" | AppLocale;

export const languageOptions: ReadonlyArray<{
  value: AppLocale;
  label: string;
}> = [
  { value: "en", label: "English" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "zh-Hant", label: "正體中文" },
  { value: "hak", label: "客家語" },
];

export function resolveDeviceLocale(
  languageTag?: string,
  languageCode?: string | null,
): AppLocale {
  const tag = languageTag?.toLowerCase() ?? "";
  const code = languageCode?.toLowerCase() ?? tag.split("-")[0];
  if (code === "hak") return "hak";
  if (code !== "zh") return "en";
  if (/-(hant|tw|hk|mo)(-|$)/.test(tag)) return "zh-Hant";
  return "zh-Hans";
}
