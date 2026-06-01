export interface State {
  trackId: string;
  artist: string;
  track: string;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
}

export interface QueueItem {
  trackId: string;
  artist: string;
  track: string;
}

export interface Player {
  state(): Promise<State | null>;
  queue(): Promise<QueueItem[]>;
}
