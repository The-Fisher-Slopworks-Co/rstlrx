import type { Player, QueueItem, State } from "../index";
import { SpotifyAuth } from "./auth";

// Spotify JSON response interfaces — snake_case to match the wire format.
interface SpotifyArtist {
  name: string;
}

interface SpotifyItem {
  id: string;
  name: string;
  duration_ms?: number;
  artists: SpotifyArtist[];
}

interface SpotifyResponse {
  is_playing: boolean;
  progress_ms?: number | null;
  item?: SpotifyItem | null;
}

interface SpotifyQueueResponse {
  queue: SpotifyItem[];
}

function joinArtists(artists: SpotifyArtist[]): string {
  return artists.map((a) => a.name).join(" ");
}

function parseResponse(data: SpotifyResponse): State | null {
  const item = data.item;
  if (item === null || item === undefined) {
    return null;
  }

  const artist = joinArtists(item.artists);

  return {
    trackId: item.id,
    artist,
    track: item.name,
    positionMs: data.progress_ms ?? 0,
    durationMs: item.duration_ms ?? 0,
    isPlaying: data.is_playing,
  };
}

function parseQueueResponse(data: SpotifyQueueResponse): QueueItem[] {
  return data.queue.slice(0, 1).map((item) => {
    const artist = joinArtists(item.artists);
    return {
      trackId: item.id,
      artist,
      track: item.name,
    };
  });
}

class SpotifyPlayer implements Player {
  private readonly auth: SpotifyAuth;

  constructor(auth: SpotifyAuth) {
    this.auth = auth;
  }

  async state(): Promise<State | null> {
    const token = await this.auth.getToken();

    const resp = await fetch(
      "https://api.spotify.com/v1/me/player/currently-playing",
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (resp.status === 204) {
      return null;
    }

    if (!resp.ok) {
      throw new Error(`spotify: ${statusText(resp)}`);
    }

    const data = (await resp.json()) as SpotifyResponse;
    return parseResponse(data);
  }

  async queue(): Promise<QueueItem[]> {
    const token = await this.auth.getToken();

    const resp = await fetch("https://api.spotify.com/v1/me/player/queue", {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });

    if (resp.status === 204) {
      return [];
    }

    if (!resp.ok) {
      throw new Error(`spotify queue: ${statusText(resp)}`);
    }

    const data = (await resp.json()) as SpotifyQueueResponse;
    return parseQueueResponse(data);
  }
}

function statusText(resp: Response): string {
  return resp.statusText ? `${resp.status} ${resp.statusText}` : `${resp.status}`;
}

export {
  SpotifyPlayer,
  joinArtists,
  parseResponse,
  parseQueueResponse,
  type SpotifyResponse,
  type SpotifyQueueResponse,
  type SpotifyItem,
  type SpotifyArtist,
};
