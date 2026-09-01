// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import {
  indexedDB as mockIndexedDB
} from 'fake-indexeddb';
import { createRetrieKeywordFilter } from 'foxts/retrie';
import { createFakeNativeFunction } from '../utils/fake-native-function';
import { noop } from 'foxts/noop';

const defusedPattern = createRetrieKeywordFilter([
  'pbp3', 'pbp_', 'pbpstate',
  'BILI_MIRROR', 'MIRROR_TRACK', '__LOG', 'reporter-pb',
  'KV_CONFIG_SDK',
  'pcdn', 'nc_loader',
  'bpcfgzip'
]);

export default function defuseStorage(logger: Logger): ModuleMeta {
  return {
    name: 'disable-storage',
    description: '防止叔叔浪费你宝贵的 SSD 寿命',
    any() {
      deleteIndexedDB();

      ((origOpen) => {
        unsafeWindow.indexedDB.open = createFakeNativeFunction(function (this: IDBFactory, name, version) {
          if (defusedPattern(name)) {
            logger.trace('IndexedDB mocked!', { name, version });
            return mockIndexedDB.open(name, version);
          }

          logger.trace('IndexedDB opened!', { name, version });
          return origOpen.call(this, name, version);
        });
        // eslint-disable-next-line @typescript-eslint/unbound-method -- override native method
      })(unsafeWindow.indexedDB.open);

      ((orignalLocalStorage) => {
        for (let i = 0; i < orignalLocalStorage.length; i++) {
          const key = orignalLocalStorage.key(i);
          if (key && defusedPattern(key)) {
            orignalLocalStorage.removeItem(key);
            logger.info('localStorage removed!', { key });
          }
        }

        const store = new Map<string, string>();
        const keys: string[] = Object.keys(orignalLocalStorage);

        const mockedLocalStorage: Storage = {
          setItem(key, value) {
            keys.push(key);

            if (defusedPattern(key)) {
              if (process.env.DEBUG) {
                logger.trace('localStorage.setItem mocked:', { key, value });
              } else {
                logger.info('localStorage.setItem mocked:', { key, value });
              }

              orignalLocalStorage.removeItem(key);
              store.set(key, value);
            } else {
              orignalLocalStorage.setItem(key, value);
            }
          },
          getItem(key) {
            if (defusedPattern(key)) {
              const value = store.has(key) ? store.get(key)! : null;

              if (process.env.DEBUG) {
                logger.trace('localStorage.getItem mocked:', { key, value });
              } else {
                logger.info('localStorage.getItem mocked:', { key, value });
              }

              return value;
            }

            // logger.trace('localStorage.getItem:', { key });
            return orignalLocalStorage.getItem(key);
          },
          removeItem(key) {
            const keyIndex = keys.indexOf(key);
            if (keyIndex > -1) {
              keys.splice(keys.indexOf(key), 1);
            }

            if (defusedPattern(key)) {
              if (process.env.DEBUG) {
                logger.trace('localStorage.removeItem mocked:', { key });
              } else {
                logger.info('localStorage.removeItem mocked:', { key });
              }

              store.delete(key);
            } else {
              // logger.trace('localStorage.removeItem:', { key });
              orignalLocalStorage.removeItem(key);
            }
          },
          clear() {
            if (process.env.DEBUG) {
              logger.trace('localStorage.clear mocked');
            } else {
              logger.info('localStorage.clear mocked');
            }

            store.clear();
            orignalLocalStorage.clear();

            keys.length = 0;
          },
          get length() {
            // 真机冒烟（2026-09-01）：bare localStorage 在扩展 MAIN world（单全局域）解析到本 mock 自身，
            // 自引用递归炸栈——视频页 force-enable-4k 钩子首个读 length 即抛 RangeError，
            // 杀死整个 dispatch 循环（no-p2p/no-webrtc/remove-black-backdrop-filter 全部未执行）。
            // 必须读闭包内的 orignalLocalStorage。
            return store.size + orignalLocalStorage.length;
          },
          key(index) {
            const realIndex = keys.length - index - 1;
            return keys[realIndex] ?? null;
          }
        };

        Object.defineProperty(unsafeWindow, 'localStorage', {
          get() {
            return mockedLocalStorage;
          },
          enumerable: true,
          configurable: false,
          set: noop
        });
      })(unsafeWindow.localStorage);
    }
  };

  async function deleteIndexedDB() {
    if (!('databases' in unsafeWindow.indexedDB)) {
      return;
    }
    const dbs = await unsafeWindow.indexedDB.databases();
    for (let i = 0, len = dbs.length; i < len; i++) {
      const db = dbs[i];
      if (db.name && defusedPattern(db.name)) {
        logger.info('IndexedDB deleted!', { name: db.name });
        unsafeWindow.indexedDB.deleteDatabase(db.name);
      }
    }
  }
}
