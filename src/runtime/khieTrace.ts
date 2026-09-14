const start = Date.now();

export function khieTrace(event: string, details: Record<string, unknown> = {}): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;

  console.log(
    `[khie-trace] ${JSON.stringify({
      at: new Date().toISOString(),
      elapsedMs: Date.now() - start,
      event,
      ...details,
    })}`,
  );
}
