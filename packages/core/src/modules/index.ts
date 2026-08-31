// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
// 模块顺序与上游 src/index.ts 的 modules 数组一致
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import defuseStorage from './defuse-storage';
import defuseSpyware from './defuse-spyware';
import disableAV1 from './disable-av1';
import enhanceLive from './enhance-live';
import fixCopyInCV from './fix-copy-in-cv';
import forceEnable4K from './force-enable-4k';
import noAd from './no-ad';
import noP2P from './no-p2p';
import noWebRTC from './no-webtrc';
import optimizeHomepage from './optimize-homepage';
import optimizeStory from './optimize-story';
import playerVideoFit from './player-video-fit';
import removeBlackBackdropFilter from './remove-black-backdrop-filter';
import removeUselessUrlParams from './remove-useless-url-params';
import useSystemFonts from './use-system-fonts';

export function getDefaultModules(logger: Logger): ModuleMeta[] {
  return [
    defuseStorage(logger),
    defuseSpyware(logger),
    disableAV1(logger),
    enhanceLive(logger),
    fixCopyInCV(logger),
    forceEnable4K(logger),
    noAd(logger),
    noP2P(logger),
    noWebRTC(logger),
    optimizeHomepage(logger),
    optimizeStory(logger),
    playerVideoFit(logger),
    removeBlackBackdropFilter(logger),
    removeUselessUrlParams(logger),
    useSystemFonts(logger)
  ];
}
