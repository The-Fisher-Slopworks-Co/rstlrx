import { test, expect } from "bun:test";

import { Channel } from "./channel";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("buffered send then recv returns the value", async () => {
  const ch = new Channel<number>();
  expect(ch.send(7)).toBe(true);
  expect(await ch.recv()).toBe(7);
});

test("pending recv is resolved by a later send", async () => {
  const ch = new Channel<number>();
  const p = ch.recv();
  let settled = false;
  void p.then(() => {
    settled = true;
  });
  // Nothing sent yet → the recv promise must still be pending.
  await sleep(5);
  expect(settled).toBe(false);
  expect(ch.send(42)).toBe(true);
  expect(await p).toBe(42);
});

test("buffer preserves FIFO order", async () => {
  const ch = new Channel<string>();
  ch.send("a");
  ch.send("b");
  ch.send("c");
  expect(await ch.recv()).toBe("a");
  expect(await ch.recv()).toBe("b");
  expect(await ch.recv()).toBe("c");
});

test("waiters are resolved in FIFO order (oldest waiter wins each send)", async () => {
  const ch = new Channel<number>();
  const p1 = ch.recv();
  const p2 = ch.recv();
  // Two waiters queued; each send resolves the oldest one first.
  ch.send(1);
  ch.send(2);
  expect(await p1).toBe(1);
  expect(await p2).toBe(2);
});

test("lose-a-race-then-reawait delivers the value (not lost)", async () => {
  const ch = new Channel<number>();
  // Bind the recv promise ONCE. We race the SAME promise via `.then()` each
  // round; `.then()` does not register a new waiter (only `recv()` does).
  const recvP = ch.recv();

  // Round 1: nothing sent and not closed, so recvP cannot resolve — the timer
  // deterministically wins, regardless of sleep duration.
  const round1 = await Promise.race([
    recvP.then((v) => ({ tag: "msg", v }) as const),
    sleep(10).then(() => ({ tag: "tick" }) as const),
  ]);
  expect(round1.tag).toBe("tick");

  // The recv promise lost the race but must NOT be renewed. Now a send arrives.
  expect(ch.send(99)).toBe(true);

  // Round 2: race the SAME held recvP again — the value must still be delivered.
  const round2 = await Promise.race([
    recvP.then((v) => ({ tag: "msg", v }) as const),
    sleep(50).then(() => ({ tag: "tick" }) as const),
  ]);
  expect(round2).toEqual({ tag: "msg", v: 99 });
});

test("renewing recv() every race iteration would orphan waiters (counter-example)", async () => {
  // This documents WHY the held-promise rule matters: if a consumer creates a
  // fresh recv() every loop, multiple waiters pile up and the send resolves the
  // oldest (orphaned) one. Here both promises eventually resolve, but a real
  // select loop that abandons the loser would drop the message.
  const ch = new Channel<number>();
  const orphaned = ch.recv(); // round 1 waiter, abandoned after losing the race
  await Promise.race([orphaned, sleep(10)]); // timer wins; orphaned still pending
  const renewed = ch.recv(); // BUG pattern: a second waiter for the next loop

  ch.send(5);
  // FIFO send resolves the OLDEST waiter (the orphaned one), not the renewed one.
  expect(await orphaned).toBe(5);

  let renewedSettled = false;
  void renewed.then(() => {
    renewedSettled = true;
  });
  await sleep(5);
  expect(renewedSettled).toBe(false); // the message went to the wrong (orphaned) waiter
});

test("close resolves a pending recv with undefined", async () => {
  const ch = new Channel<number>();
  const p = ch.recv();
  ch.close();
  expect(await p).toBeUndefined();
});

test("send after close returns false", () => {
  const ch = new Channel<number>();
  ch.close();
  expect(ch.send(1)).toBe(false);
});

test("recv after close on an empty channel resolves undefined", async () => {
  const ch = new Channel<number>();
  ch.close();
  expect(await ch.recv()).toBeUndefined();
});

test("isClosed reflects close state", () => {
  const ch = new Channel<number>();
  expect(ch.isClosed).toBe(false);
  ch.close();
  expect(ch.isClosed).toBe(true);
});

test("buffered values drain after close, then recv yields undefined", async () => {
  const ch = new Channel<number>();
  ch.send(1);
  ch.send(2);
  ch.close();
  // recv checks the buffer before the closed flag, so buffered items survive.
  expect(await ch.recv()).toBe(1);
  expect(await ch.recv()).toBe(2);
  expect(await ch.recv()).toBeUndefined();
});

test("close is idempotent", () => {
  const ch = new Channel<number>();
  ch.close();
  ch.close();
  expect(ch.isClosed).toBe(true);
  expect(ch.send(1)).toBe(false);
});

test("multiple pending recvs all resolve undefined on close", async () => {
  const ch = new Channel<number>();
  const p1 = ch.recv();
  const p2 = ch.recv();
  const p3 = ch.recv();
  ch.close();
  expect(await p1).toBeUndefined();
  expect(await p2).toBeUndefined();
  expect(await p3).toBeUndefined();
});

test("interleaved send/recv with both buffered and pending paths", async () => {
  const ch = new Channel<number>();
  // Pending path: recv before send.
  const pending = ch.recv();
  ch.send(10);
  expect(await pending).toBe(10);
  // Buffered path: send before recv.
  ch.send(20);
  expect(await ch.recv()).toBe(20);
});
