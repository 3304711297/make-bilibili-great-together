// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
export function createFakeNativeFunction<T extends Function>(cb: T): T {
  const fnName = cb.name || '';

  const toStringFn = () => `function ${fnName}() { [native code] }`;

  Object.defineProperties(cb, {
    toString: {
      value: toStringFn,
      writable: true,
      configurable: false,
      enumerable: false
    },
    toLocaleString: {
      value: toStringFn,
      writable: true,
      configurable: false,
      enumerable: false
    }
  });

  return cb;
}
