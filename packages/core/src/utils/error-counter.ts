// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
const ERROR_REPORT_INTERVAL = 30_000;

export class ErrorCounter {
  private lastReportTime = new Map<string, number>();

  shouldReport(key: string): boolean {
    const now = Date.now();
    const last = this.lastReportTime.get(key);
    if (last !== undefined && now - last < ERROR_REPORT_INTERVAL) {
      return false;
    }
    this.lastReportTime.set(key, now);
    return true;
  }
}
