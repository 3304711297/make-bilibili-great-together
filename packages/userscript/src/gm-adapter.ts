export function unsafeConsole(): Console {
  return unsafeWindow.console;
}

export const unsafeWindowRef = unsafeWindow;
