// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import { noop } from 'foxts/noop';

export function defineReadonlyProperty<T, K extends string | symbol>(
  target: T,
  key: K,
  value: K extends keyof T ? T[K] : unknown,
  enumerable = true
) {
  Object.defineProperty(target, key, {
    get() {
      return value;
    },
    set: noop,
    configurable: false,
    enumerable
  });
}
