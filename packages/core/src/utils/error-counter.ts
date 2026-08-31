// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
const ERROR_REPORT_INTERVAL = 30_000;

class ListNode {
  public next: ListNode | null = null;
  public prev: ListNode | null = null;

  constructor(public timestamp: number) { }
}

export class ErrorCounter {
  private lastReportTime = new Map<string, number>();

  private head: ListNode | null = null;
  private tail: ListNode | null = null;
  private $size = 0;

  constructor(private readonly timeWindow = 10_000) { }

  shouldReport(key: string): boolean {
    const now = Date.now();
    const last = this.lastReportTime.get(key);
    if (last !== undefined && now - last < ERROR_REPORT_INTERVAL) {
      return false;
    }
    this.lastReportTime.set(key, now);
    return true;
  }

  recordError() {
    const now = Date.now();
    const newNode = new ListNode(now);

    if (this.tail) {
      this.tail.next = newNode;
      newNode.prev = this.tail;
    } else {
      this.head = newNode;
    }
    this.tail = newNode;

    this.$size++;
  }

  getErrorCount(): number {
    this.cleanup();

    return this.$size;
  }

  stop() {
    // 上游在构造时以 self.setInterval 周期性 cleanup；core 内改为
    // getErrorCount() 时惰性 cleanup（对外的可见行为一致），故此处无定时器可清。
  }

  private cleanup() {
    const now = Date.now();
    while (this.head && now - this.head.timestamp > this.timeWindow) {
      this.head = this.head.next;
      if (this.head) {
        this.head.prev = null;
      } else {
        this.tail = null;
      }
      this.$size--;
    }
  }
}
