# Fake source

A dev and test IPTV source: an M3U playlist, an XMLTV guide and live MPEG-TS streams generated
by ffmpeg (8 or newer), with fault injection for the recorder's tests. `pnpm dev` and `pnpm e2e`
start it; on its own:

```sh
node tools/fake-source/src/bin/fake-source.ts --port 8090
```

`GET /` lists every endpoint and parameter; `--help` lists the flags.

## Line-ups

| Playlist                   | Guide                 | What                                                    |
| -------------------------- | --------------------- | ------------------------------------------------------- |
| `/playlist.m3u`            | `/epg.xml`            | Eight channels with full schedules (F1, news, series…)  |
| `/playlist.m3u?lineup=big` | `/epg.xml?lineup=big` | About 4,800 streams in 28 groups, like a big IPTV panel |

The big line-up (`src/big-lineup.ts`) is for the stream picker and anything else that has to cope
with a large playlist:

- 28 groups: `DE | Vollprogramm`, `DE | Sport` and eight more German ones, `AT | Österreich`,
  `CH | Schweiz`, four `UK |` and three `US |` groups, six more countries, `VOD | Filme`,
  `VOD | Serien` and `Radio`.
- Channels come as copies: always `… HD`, most also without a tag (SD), some as `… FHD`. Copies
  share their `tvg-id`.
- The guide covers part of them (98 % of `DE | Vollprogramm`, 25 % of `PL | Ogólne`, nothing of
  VOD and radio). Covered channels are guide channels without programmes; some uncovered streams
  carry a `tvg-id` the guide lacks, the rest none.
- The eight normal channels are in it too, under their own guide ids, with their programmes: on a
  server that already has them, those streams join the existing channels.
- Every entry plays one of the eight test streams, so anything added can be watched and recorded.
- The list is the same on every start (no randomness), so tests can name streams.

Fault parameters on the playlist (`?dropAfter=5`, …) reach the big line-up's stream URLs as well.
