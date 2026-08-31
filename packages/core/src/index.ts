export { createCore, type CoreOptions, type CoreInstance } from './engine/scheduler';
export type { ModuleMeta, MakeBilibiliGreatTogetherHook, CompatConflict } from './types';
export { createLogger, type Logger, type MinimalConsole } from './logger';
export { ErrorCounter } from './utils/error-counter';
export const MBGT_VERSION = '0.1.0';
