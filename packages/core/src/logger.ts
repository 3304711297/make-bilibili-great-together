export type MinimalConsole = Pick<Console, 'log' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'group' | 'groupCollapsed' | 'groupEnd'>;

const PREFIX = '[mbgt]';

export function createLogger(console: MinimalConsole) {
  const noop = (..._: unknown[]) => {};
  return {
    log: console.log.bind(console, PREFIX),
    error: console.error.bind(console, PREFIX),
    warn: console.warn.bind(console, PREFIX),
    info: console.info.bind(console, PREFIX),
    debug: noop,
    trace: noop,
    group: console.group.bind(console, PREFIX),
    groupCollapsed: console.groupCollapsed.bind(console, PREFIX),
    groupEnd: console.groupEnd.bind(console)
  };
}

export type Logger = ReturnType<typeof createLogger>;
