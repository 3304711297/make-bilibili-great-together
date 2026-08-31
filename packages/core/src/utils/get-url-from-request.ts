// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { Logger } from '../logger';

export function getUrlFromRequest(request: RequestInfo | URL, logger?: Logger): string | null {
  if (typeof request === 'string') {
    return request;
  }
  if (typeof request !== 'object' || request === null) {
    logger?.error('Invalid requestInfo', request);
    return null;
  }
  if ('href' in request) {
    return request.href;
  }
  if ('url' in request) {
    return request.url;
  }

  const _: never = request;
  logger?.error('Invalid requestInfo', request);
  return null;
}
