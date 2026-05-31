// Async MPSC channel replacing `tokio::sync::mpsc`.
//
// FIFO resolver-queue implementation: a held `recv()` promise always receives
// the next `send()`. Invariants:
//   - buffer non-empty  ⟹  no queued waiters (send with a waiter resolves it
//     directly and never also buffers).
//   - `recv` checks `buffer` BEFORE `closed`, so buffered items drain even
//     after `close()`.

export class Channel<T> {
  private buffer: T[] = [];
  private waiters: ((v: T | undefined) => void)[] = [];
  private closed = false;

  // Non-blocking, unbounded. Returns false if the channel is closed
  // (mirrors Rust `Sender::send` returning `Err`).
  send(value: T): boolean {
    if (this.closed) return false;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(value);
    } else {
      this.buffer.push(value);
    }
    return true;
  }

  // Resolves the next value, or `undefined` once the channel is closed AND
  // drained.
  recv(): Promise<T | undefined> {
    if (this.buffer.length > 0) {
      return Promise.resolve(this.buffer.shift());
    }
    if (this.closed) {
      return Promise.resolve(undefined);
    }
    return new Promise<T | undefined>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  // Marks the channel closed and resolves every queued waiter with `undefined`.
  // Buffered values remain available to `recv()` until drained.
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter(undefined);
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
