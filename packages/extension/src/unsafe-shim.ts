(globalThis as unknown as { unsafeWindow?: Window & typeof globalThis }).unsafeWindow ??= globalThis as unknown as Window & typeof globalThis;
