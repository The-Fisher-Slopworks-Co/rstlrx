import { Channel } from "./channel";
import { ensureLeadingLine, type Line, type LyricsProvider } from "./lyrics";
import type { Player, State } from "./player";
import type { DisplayLine, Update } from "./renderer";

export interface SyncConfig {
  playerPollInterval: number;
  uiTimerInterval: number;
  mergeQueue: boolean;
}

export function defaultSyncConfig(): SyncConfig {
  return {
    playerPollInterval: 2000,
    uiTimerInterval: 200,
    mergeQueue: false,
  };
}

// Mirrors the Rust `Result<Option<State>>` value carried over the player-poll
// channel. `ok: false` is the `Err(_)` arm (which the loop ignores).
type PollResult = { ok: true; state: State | null } | { ok: false };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

class SyncState {
  currentTrackId = "";
  currentLyrics: Line[] = [];
  displayLines: DisplayLine[] = [];
  currentTrackOffset = 0;
  currentDuration = 0;
  nextLyrics: Line[] = [];
  nextArtist = "";
  nextTrackName = "";
  nextTrackId = "";
  nextTrackStart: number | null = null;
  index = 0;
  lastStatePosition = 0;
  lastStateTime: number = Date.now();
  isPlaying = false;
  error: string | null = null;
  queueRechecked = false;

  interpolatedPosition(): number {
    if (this.isPlaying) {
      return this.lastStatePosition + (Date.now() - this.lastStateTime);
    }
    return this.lastStatePosition;
  }

  static lyricsToDisplay(lyrics: Line[]): DisplayLine[] {
    return lyrics.map((line) => ({ kind: "lyric", line }));
  }

  clear(): void {
    this.currentTrackId = "";
    this.currentLyrics = [];
    this.displayLines = [];
    this.nextLyrics = [];
    this.nextTrackId = "";
    this.nextTrackStart = null;
    this.currentTrackOffset = 0;
    this.currentDuration = 0;
    this.index = 0;
    this.error = null;
  }

  toUpdate(): Update {
    return {
      lines: this.displayLines.slice(),
      index: this.index,
      error: this.error,
    };
  }

  async fetchNextTrack(
    player: Player,
    provider: LyricsProvider,
    mergeQueue: boolean,
  ): Promise<void> {
    this.nextLyrics = [];
    this.nextTrackId = "";
    this.nextTrackStart = null;
    let queue;
    try {
      queue = await player.queue();
    } catch {
      return;
    }
    const next = queue[0];
    if (next === undefined) {
      return;
    }
    this.nextTrackId = next.trackId;
    this.nextArtist = next.artist;
    this.nextTrackName = next.track;
    let nl: Line[];
    try {
      nl = await provider.fetch(this.nextArtist, this.nextTrackName);
    } catch {
      return;
    }
    this.nextLyrics = nl;
    ensureLeadingLine(this.nextLyrics);
    if (mergeQueue) {
      this.nextTrackStart = appendNextTrack(
        this.displayLines,
        this.nextArtist,
        this.nextTrackName,
        this.nextLyrics,
      );
    }
  }

  async transitionToNewTrack(
    trackId: string,
    artist: string,
    track: string,
    provider: LyricsProvider,
    player: Player,
    smooth: boolean,
    mergeQueue: boolean,
  ): Promise<void> {
    if (smooth) {
      // `unwrap()`: smooth is only true when nextTrackStart is set.
      this.currentTrackOffset = this.nextTrackStart as number;
      this.currentLyrics = this.nextLyrics;
      this.nextLyrics = [];
    } else if (trackId === this.nextTrackId && this.nextLyrics.length > 0) {
      this.currentTrackOffset = 0;
      this.currentLyrics = this.nextLyrics;
      this.nextLyrics = [];
      this.displayLines = SyncState.lyricsToDisplay(this.currentLyrics);
    } else {
      this.currentTrackOffset = 0;
      let l: Line[];
      try {
        l = await provider.fetch(artist, track);
      } catch (e) {
        this.currentLyrics = [];
        this.displayLines = [];
        this.nextLyrics = [];
        this.nextTrackId = "";
        this.nextTrackStart = null;
        this.error = e instanceof Error ? e.message : String(e);
        this.currentTrackId = trackId;
        this.index = 0;
        return;
      }
      this.currentLyrics = l;
      ensureLeadingLine(this.currentLyrics);
      this.displayLines = SyncState.lyricsToDisplay(this.currentLyrics);
    }

    this.currentTrackId = trackId;
    this.index = this.currentTrackOffset;
    this.error = null;

    await this.fetchNextTrack(player, provider, mergeQueue);
  }
}

export function startSync(
  player: Player,
  provider: LyricsProvider,
  config: SyncConfig,
): Channel<Update> {
  const tx = new Channel<Update>();
  // Spawn the loop; do NOT await.
  void syncLoop(player, provider, config, tx);
  return tx;
}

async function syncLoop(
  player: Player,
  provider: LyricsProvider,
  config: SyncConfig,
  tx: Channel<Update>,
): Promise<void> {
  const playerChan = new Channel<PollResult>();

  // Player-poll task: poll `state()`, push the result, sleep, repeat. Breaks
  // when the channel is closed (mirrors `send(...).is_err()`).
  void (async () => {
    while (true) {
      let result: PollResult;
      try {
        const state = await player.state();
        result = { ok: true, state };
      } catch {
        result = { ok: false };
      }
      if (!playerChan.send(result)) {
        break;
      }
      await sleep(config.playerPollInterval);
    }
  })();

  const state = new SyncState();
  let sleepDuration = config.uiTimerInterval;

  // Stable-promise race: hold `recvP` across iterations and renew it ONLY when
  // the player branch resolves.
  let recvP = playerChan.recv();

  while (true) {
    const winner = await Promise.race([
      recvP.then((v) => ({ tag: "msg", v }) as const),
      sleep(sleepDuration).then(() => ({ tag: "tick" }) as const),
    ]);

    if (winner.tag === "msg") {
      const result = winner.v;
      recvP = playerChan.recv();
      // `Some(result) = player_rx.recv()`: `undefined` means closed → skip.
      if (result !== undefined) {
        if (result.ok && result.state !== null) {
          const playerState = result.state;
          state.isPlaying = playerState.isPlaying;
          state.currentDuration = playerState.durationMs;

          if (playerState.trackId !== state.currentTrackId) {
            const smooth =
              playerState.trackId === state.nextTrackId &&
              state.nextTrackStart !== null;

            await state.transitionToNewTrack(
              playerState.trackId,
              playerState.artist,
              playerState.track,
              provider,
              player,
              smooth && config.mergeQueue,
              config.mergeQueue,
            );
            state.queueRechecked = false;
          }

          state.lastStatePosition = playerState.positionMs;
          state.lastStateTime = Date.now();
        } else if (result.ok && result.state === null) {
          state.isPlaying = false;
          if (state.currentTrackId !== "") {
            state.clear();
          }
        }
        // result.ok === false → Err(_) arm: do nothing.
      }
    }
    // tick branch: just loop; do NOT recreate recvP.

    const position = state.interpolatedPosition();

    // Recheck queue 10s before track ends.
    if (
      config.mergeQueue &&
      state.isPlaying &&
      !state.queueRechecked &&
      state.currentDuration > 10000 &&
      position >= state.currentDuration - 10000
    ) {
      state.queueRechecked = true;
      let queue;
      try {
        queue = await player.queue();
      } catch {
        queue = null;
      }
      if (queue !== null) {
        const firstItem = queue[0];
        const newNextId: string | null =
          firstItem !== undefined ? firstItem.trackId : null;
        const oldNextId: string | null =
          state.nextTrackId === "" ? null : state.nextTrackId;

        if (newNextId !== oldNextId) {
          if (state.nextTrackStart !== null) {
            const truncLen = Math.max(state.nextTrackStart - 1, 0);
            state.displayLines.length = Math.min(
              truncLen,
              state.displayLines.length,
            );
          }
          state.nextLyrics = [];
          state.nextTrackId = "";
          state.nextTrackStart = null;

          const next = queue[0];
          if (next !== undefined) {
            state.nextTrackId = next.trackId;
            state.nextArtist = next.artist;
            state.nextTrackName = next.track;
            let nl: Line[] | null;
            try {
              nl = await provider.fetch(state.nextArtist, state.nextTrackName);
            } catch {
              nl = null;
            }
            if (nl !== null) {
              state.nextLyrics = nl;
              ensureLeadingLine(state.nextLyrics);
              state.nextTrackStart = appendNextTrack(
                state.displayLines,
                state.nextArtist,
                state.nextTrackName,
                state.nextLyrics,
              );
            }
          }
        }
      }
    }

    // Auto-transition when position reaches track duration.
    if (
      state.isPlaying &&
      state.currentDuration > 0 &&
      position >= state.currentDuration &&
      state.nextTrackId !== ""
    ) {
      const overflow = position - state.currentDuration;

      if (config.mergeQueue && state.nextTrackStart !== null) {
        state.currentTrackOffset = state.nextTrackStart;
      } else {
        state.currentTrackOffset = 0;
        state.displayLines = SyncState.lyricsToDisplay(state.nextLyrics);
      }

      state.currentLyrics = state.nextLyrics;
      state.nextLyrics = [];
      state.currentTrackId = state.nextTrackId;
      state.currentDuration = 0;
      state.index = state.currentTrackOffset;
      state.error = null;
      state.queueRechecked = false;

      await state.fetchNextTrack(player, provider, config.mergeQueue);

      state.lastStatePosition = overflow;
      state.lastStateTime = Date.now();
    }

    // Calculate current line index.
    if (state.currentLyrics.length > 0) {
      const localCurrent = Math.max(state.index - state.currentTrackOffset, 0);
      const clamped = Math.min(
        localCurrent,
        Math.max(state.currentLyrics.length - 1, 0),
      );
      const localIndex = getIndex(position, clamped, state.currentLyrics);
      state.index = state.currentTrackOffset + localIndex;
    }

    // Schedule next wake-up precisely at the next line transition.
    if (state.isPlaying && state.currentLyrics.length > 0) {
      const localIdx = Math.max(state.index - state.currentTrackOffset, 0);
      if (localIdx + 1 < state.currentLyrics.length) {
        const nextTimeMs = state.currentLyrics[localIdx + 1]!.timeMs;
        const posNow = state.interpolatedPosition();
        if (nextTimeMs > posNow) {
          sleepDuration = Math.min(nextTimeMs - posNow, config.uiTimerInterval);
        } else {
          sleepDuration = 10;
        }
      } else {
        sleepDuration = config.uiTimerInterval;
      }
    } else {
      sleepDuration = config.uiTimerInterval;
    }

    if (!tx.send(state.toUpdate())) {
      break;
    }
  }

  playerChan.close();
}

export function getIndex(
  positionMs: number,
  currentIndex: number,
  lines: Line[],
): number {
  if (lines.length <= 1) {
    return 0;
  }

  if (positionMs >= lines[currentIndex]!.timeMs) {
    for (let i = currentIndex + 1; i < lines.length; i++) {
      if (positionMs < lines[i]!.timeMs) {
        return i - 1;
      }
    }
    return lines.length - 1;
  }

  for (let i = currentIndex; i >= 1; i--) {
    if (positionMs >= lines[i]!.timeMs) {
      return i;
    }
  }
  return 0;
}

export function appendNextTrack(
  displayLines: DisplayLine[],
  artist: string,
  track: string,
  lyrics: Line[],
): number | null {
  if (lyrics.length === 0) {
    return null;
  }
  displayLines.push({ kind: "separator", text: `── ${artist} - ${track} ──` });
  const start = displayLines.length;
  for (const line of lyrics) {
    displayLines.push({ kind: "lyric", line });
  }
  return start;
}
