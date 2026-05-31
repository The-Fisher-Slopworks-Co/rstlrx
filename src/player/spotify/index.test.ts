import { test, expect } from "bun:test";
import {
  parseResponse,
  parseQueueResponse,
  type SpotifyResponse,
  type SpotifyQueueResponse,
} from "./index";

test("test_parse_spotify_response", () => {
  const json = `{
    "is_playing": true,
    "progress_ms": 42000,
    "item": {
      "id": "abc123",
      "name": "The Night We Met",
      "duration_ms": 207000,
      "artists": [{"name": "Lord Huron"}]
    }
  }`;
  const resp = JSON.parse(json) as SpotifyResponse;
  const state = parseResponse(resp);
  expect(state).not.toBeNull();
  expect(state!.trackId).toEqual("abc123");
  expect(state!.artist).toEqual("Lord Huron");
  expect(state!.track).toEqual("The Night We Met");
  expect(state!.positionMs).toEqual(42000);
  expect(state!.durationMs).toEqual(207000);
  expect(state!.isPlaying).toBe(true);
});

test("test_parse_spotify_response_multiple_artists", () => {
  const json = `{
    "is_playing": true,
    "progress_ms": 0,
    "item": {
      "id": "xyz",
      "name": "Song",
      "artists": [{"name": "Artist A"}, {"name": "Artist B"}]
    }
  }`;
  const resp = JSON.parse(json) as SpotifyResponse;
  const state = parseResponse(resp);
  expect(state).not.toBeNull();
  expect(state!.artist).toEqual("Artist A Artist B");
});

test("test_parse_spotify_response_no_item", () => {
  const json = `{"is_playing": false, "progress_ms": null, "item": null}`;
  const resp = JSON.parse(json) as SpotifyResponse;
  expect(parseResponse(resp)).toBeNull();
});

test("test_parse_queue_response_with_items", () => {
  const json = `{
    "currently_playing": null,
    "queue": [
      {
        "id": "next1",
        "name": "Next Song",
        "artists": [{"name": "Next Artist"}]
      },
      {
        "id": "next2",
        "name": "After That",
        "artists": [{"name": "Other Artist"}]
      }
    ]
  }`;
  const resp = JSON.parse(json) as SpotifyQueueResponse;
  const items = parseQueueResponse(resp);
  expect(items.length).toEqual(1);
  expect(items[0].trackId).toEqual("next1");
  expect(items[0].artist).toEqual("Next Artist");
  expect(items[0].track).toEqual("Next Song");
});

test("test_parse_queue_response_empty", () => {
  const json = `{"currently_playing": null, "queue": []}`;
  const resp = JSON.parse(json) as SpotifyQueueResponse;
  const items = parseQueueResponse(resp);
  expect(items.length).toEqual(0);
});

test("test_parse_queue_response_multiple_artists", () => {
  const json = `{
    "currently_playing": null,
    "queue": [{
      "id": "q1",
      "name": "Collab",
      "artists": [{"name": "A"}, {"name": "B"}]
    }]
  }`;
  const resp = JSON.parse(json) as SpotifyQueueResponse;
  const items = parseQueueResponse(resp);
  expect(items[0].artist).toEqual("A B");
});
