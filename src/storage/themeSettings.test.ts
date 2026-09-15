import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(async () => {}),
}));

vi.mock("expo-secure-store", () => secureStore);

import { SecureStoreThemeSettings } from "./themeSettings";

describe("SecureStoreThemeSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to following the system", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(null);
    await expect(new SecureStoreThemeSettings().load()).resolves.toBe("system");
  });

  it("loads a saved appearance", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce("dark");
    await expect(new SecureStoreThemeSettings().load()).resolves.toBe("dark");
  });

  it("ignores an invalid saved appearance", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce("sepia");
    await expect(new SecureStoreThemeSettings().load()).resolves.toBe("system");
  });

  it("saves the selected appearance", async () => {
    await expect(new SecureStoreThemeSettings().save("light")).resolves.toBe("light");
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "khie.theme.preference.v1",
      "light",
    );
  });
});
