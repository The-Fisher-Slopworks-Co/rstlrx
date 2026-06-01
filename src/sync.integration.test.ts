import { test, expect } from "bun:test";
import { startSync, type SyncConfig } from "./sync";
import type { Line, LyricsProvider } from "./lyrics";
import type { Player, QueueItem, State } from "./player";

// Integration test for the sync select loop. The pure-function unit tests in
// sync.test.ts never drive `sync_loop`, so they cannot catch the orphaned-recv
// trap: a select loop that recreates `rx.recv()` on every iteration registers
// multiple FIFO waiters, and a later `send` resolves the oldest (orphaned) one
// — dropping the message. The first player message is still delivered even with
// the bug; orphans only accumulate from the SECOND message onward. So this test
// asserts the loop reflects a *subsequent* track change (A -> B), which is the
// discriminating condition.

const TRACK_A: State = {
  trackId: "track-a",
  artist: "Artist A",
  track: "Song A",
  positionMs: 0,
  // Large duration + tiny position keeps the auto-transition and
  // queue-recheck branches dormant so they cannot perturb displayLines.
  durationMs: 300_000,
  isPlaying: true,
};

const TRACK_B: State = {
  trackId: "track-b",
  artist: "Artist B",
  track: "Song B",
  positionMs: 0,
  durationMs: 300_000,
  isPlaying: true,
};

class FakePlayer implements Player {
  private calls = 0;

  async state(): Promise<State | null> {
    this.calls += 1;
    // First poll -> track A, every subsequent poll -> track B.
    return this.calls <= 1 ? TRACK_A : TRACK_B;
  }

  async queue(): Promise<QueueItem[]> {
    // No next-track prefetch: keeps displayLines populated solely by the
    // current track's lyrics, so a "B-lyric" sighting is unambiguous.
    return [];
  }
}

class FakeProvider implements LyricsProvider {
  async fetch(_artist: string, track: string): Promise<Line[]> {
    if (track === TRACK_B.track) {
      return [{ timeMs: 0, words: "B-lyric" }];
    }
    return [{ timeMs: 0, words: "A-lyric" }];
  }
}

test("sync loop reflects a subsequent track change in the Update stream", async () => {
  // uiTimerInterval STRICTLY less than playerPollInterval so the timer wins
  // several races between the A and B player messages — that is the window in
  // which orphaned waiters would accumulate under the buggy pattern.
  const config: SyncConfig = {
    playerPollInterval: 20,
    uiTimerInterval: 5,
    mergeQueue: false,
  };

  const rx = startSync(new FakePlayer(), new FakeProvider(), config);

  let sawBLyric = false;
  // Bound on recv COUNT (not wall-clock): between A and B there are only a
  // handful of A-updates, so 100 recvs is a large, non-flaky margin.
  for (let i = 0; i < 100; i++) {
    const update = await rx.recv();
    if (update === undefined) {
      break; // channel closed unexpectedly
    }
    const hasB = update.lines.some(
      (l) => l.kind === "lyric" && l.line.words === "B-lyric",
    );
    if (hasB) {
      sawBLyric = true;
      break;
    }
  }

  // Closing the returned channel makes the loop's `tx.send` return false and
  // break, which then closes the player-poll channel and stops its setTimeout
  // chain — otherwise lingering timers keep the test runner alive.
  rx.close();

  expect(sawBLyric).toBe(true);
});
