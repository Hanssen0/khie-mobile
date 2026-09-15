import type { TranslationKey } from "./i18n";

export class LocalizedError extends Error {
  constructor(
    readonly translationKey: TranslationKey,
    message: string,
    readonly translationValues?: Record<string, string | number>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LocalizedError";
  }
}
