import { describe, expect, it } from "vitest";

import { languageOptions, resolveDeviceLocale } from "./locale";

describe("locale selection", () => {
  it("uses the requested language names without region labels", () => {
    expect(languageOptions).toEqual([
      { value: "en", label: "English" },
      { value: "zh-Hans", label: "简体中文" },
      { value: "zh-Hant", label: "正體中文" },
      { value: "hak", label: "客家語" },
    ]);
  });

  it("maps system locales to a supported language", () => {
    expect(resolveDeviceLocale("en-US", "en")).toBe("en");
    expect(resolveDeviceLocale("zh-CN", "zh")).toBe("zh-Hans");
    expect(resolveDeviceLocale("zh-Hant", "zh")).toBe("zh-Hant");
    expect(resolveDeviceLocale("zh-HK", "zh")).toBe("zh-Hant");
    expect(resolveDeviceLocale("hak", "hak")).toBe("hak");
    expect(resolveDeviceLocale("fr-FR", "fr")).toBe("en");
  });
});
