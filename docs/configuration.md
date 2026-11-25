# Configuration

Slipstream has two layers of configuration:

- **Environment variables** for what the server needs before it starts: where data lives, which
  port it listens on, how people reach it, which proxies to trust. They are read once at startup
  (`apps/server/src/config.ts`).
- **Everything else in the web app** (sources, channels, recording defaults, users, quality,
  storage), stored in the database.

## Docker

The image is published as `ghcr.io/zernico/slipstream` for `linux/amd64` and `linux/arm64`:
`latest` is the newest release, `X.Y.Z` an exact release, `X.Y` the newest patch of a minor
version, `edge` the main branch and `sha-<commit>` one commit of it. The system page shows the
version the image was built as (an `edge` build reads like `0.1.0-edge+1a2b3c4`).

The image (`Dockerfile`) is `node:26-slim` with jellyfin-ffmpeg 8 (Jellyfin's ffmpeg build, with
GPU drivers; see [Hardware acceleration](#hardware-acceleration)) pinned by version and
checksum, and `tini` as PID 1 so ffmpeg processes are reaped. It runs as the non-root `node`
user (uid 1000) and has a healthcheck on `GET /api/health`. Upgrading ffmpeg is a deliberate
change to the image; the server's startup self-check tests the ffmpeg it finds and reports
problems on the system page.

`docker-compose.yml` at the repository root is the reference setup:

```sh
docker compose up -d                  # server and web app on http://localhost:8080
docker compose --profile demo up -d   # plus a fake IPTV source at http://fake-source:8090
```

It runs the published image; the fake source is part of it. To run a checkout instead, swap the
`image:` line for the commented `build:` lines in the file and add `--build`.

The first start opens the setup wizard, which creates the admin account. There are no default
credentials.

### Volumes

| Path      | What                                                                                          | Where to put it                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `/config` | The SQLite database, automatic backups taken before each migration (`backups/`), `secret.key` | A real local disk. **Never a FUSE or network share** (on Unraid: `/mnt/cache/appdata/...`, not `/mnt/user/...`); SQLite corrupts there |
| `/data`   | The segment store: live TV buffers and recordings                                             | Anywhere with space; a slower array is fine                                                                                            |

As a rough guide, a 6–8 Mbit/s channel takes 3–4 GB per hour of recording.

### Hardware acceleration

Slipstream detects hardware encoders (NVIDIA NVENC, Intel Quick Sync, VAAPI) at startup with a
short test encode each and shows the result in Settings. The image ships
[jellyfin-ffmpeg](https://github.com/jellyfin/jellyfin-ffmpeg), which loads the GPU drivers
(it bundles the Intel media driver); the container only needs to see the GPU. Without it,
Slipstream falls back to software and says so.

**Intel and AMD (VAAPI, Quick Sync).** Pass `/dev/dri` through and add the group that owns the
render node, so the container's user may open it. Find the group id on the host:

```sh
stat -c %g /dev/dri/renderD128
```

```yaml
services:
  slipstream:
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - "18" # the number printed above
```

With `docker run`: `--device /dev/dri --group-add 18`. Use the number, not a group name: names
inside the container need not match the host's.

**NVIDIA (NVENC).** Install the NVIDIA Container Toolkit on the host, then:

```yaml
services:
  slipstream:
    runtime: nvidia
    environment:
      NVIDIA_VISIBLE_DEVICES: all
      NVIDIA_DRIVER_CAPABILITIES: compute,video,utility
```

With `docker run`: `--runtime nvidia -e NVIDIA_VISIBLE_DEVICES=all` and
`-e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility` (or `--gpus all` with the same
capabilities).

To check by hand, `docker exec <container> vainfo` lists what the Intel or AMD driver offers.

## Environment variables

The image sets the paths and ffmpeg locations for you; the defaults in brackets are the image's
where they differ from running the server directly.

| Variable                         | Default                                                | What it does                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SLIPSTREAM_TIME_ZONE`           | the host's zone [`UTC`]                                | The server's IANA time zone, e.g. `Europe/Berlin`. Weekdays in series recordings and dates in library folders are read in it. **Set it in Docker.**                                               |
| `SLIPSTREAM_PUBLIC_URL`          | unset                                                  | How people reach Slipstream, e.g. `https://tv.example.com` (an optional path prefix is allowed, no trailing slash). Used for links (invites, TV sign-in, mDNS). `https://` makes cookies `Secure` |
| `SLIPSTREAM_TRUSTED_PROXIES`     | empty (trust nobody)                                   | Comma-separated addresses or CIDR ranges whose `X-Forwarded-*` headers are believed, e.g. `172.16.0.0/12`. See [Reverse proxy](#reverse-proxy)                                                    |
| `SLIPSTREAM_HOST`                | `0.0.0.0`                                              | Address the HTTP server binds to                                                                                                                                                                  |
| `SLIPSTREAM_PORT`                | `8080`                                                 | Port for the web app, API and HLS                                                                                                                                                                 |
| `SLIPSTREAM_CONFIG_DIR`          | `.data/config` [`/config`]                             | Database, its backups and `secret.key`                                                                                                                                                            |
| `SLIPSTREAM_DATA_DIR`            | `.data/data` [`/data`]                                 | The segment store                                                                                                                                                                                 |
| `SLIPSTREAM_WEB_DIR`             | unset: API only [`/app/apps/web/dist`]                 | A built web app to serve, with fallback to `index.html` for client-side routes                                                                                                                    |
| `SLIPSTREAM_FFMPEG`              | `ffmpeg` on `PATH` [`/usr/lib/jellyfin-ffmpeg/ffmpeg`] | ffmpeg for captures, the self-check and hardware detection                                                                                                                                        |
| `SLIPSTREAM_FFPROBE`             | next to `SLIPSTREAM_FFMPEG`, else `ffprobe`            | ffprobe for stream information                                                                                                                                                                    |
| `SLIPSTREAM_FREE_SPACE_FLOOR_GB` | `20`                                                   | Free space to keep on the segment store. Below it, live TV buffers shrink first, then retention runs early. Running recordings are never cut                                                      |
| `SLIPSTREAM_MDNS`                | `true` [`false`]                                       | Announce `_slipstream._tcp` on the local network so the Android app finds the server. In Docker this only works with host networking                                                              |
| `SLIPSTREAM_STARTUP_CHECKS`      | `true`                                                 | Run the ffmpeg self-check and hardware encoder detection in the background at startup                                                                                                             |

## Reverse proxy

Slipstream can sit behind any reverse proxy (Caddy, Traefik, nginx, ...). Set two variables:

- `SLIPSTREAM_PUBLIC_URL` to the address people use, e.g. `https://tv.example.com`. Links the
  server hands out (guest invites, TV sign-in) point there; without it they point at
  `http://localhost:<port>`, and the server warns at startup.
- `SLIPSTREAM_TRUSTED_PROXIES` to the proxy's address or network, e.g. `172.16.0.0/12` for a proxy
  on a Docker network. Slipstream then reads the client address from `X-Forwarded-For`, so
  sign-in rate limits and "home or away" see real clients. Without it every request seems to come
  from the proxy, and one person guessing passwords slows down sign-in for everyone. The server
  logs a warning when `SLIPSTREAM_PUBLIC_URL` is `https` and no proxy is trusted.

The proxy must not buffer responses on `/api/events` (server-sent events) and should allow long
requests for HLS playback.

## Backups

Back up `/config`. It holds:

- the SQLite database (WAL mode; the server also takes a `VACUUM INTO` copy into
  `/config/backups` before every migration), and
- `secret.key`, which seals source credentials and secret headers (AES-256-GCM) and signs playlist
  links and CSRF tokens.

Keep the two together: a restored database without its `secret.key` cannot read stored source
credentials. `secret.key` is as sensitive as the credentials it protects; the server creates both
readable by its own user only.

`/data` holds the recordings themselves. Back it up if you want to keep them; losing it loses
recordings but nothing else.

## Development

`pnpm dev` uses the same variables, set per checkout by `scripts/dev-state.ts`: loopback only, a
port derived from the checkout's path, data in `.data/dev`, and mDNS off unless you pass `--lan`.
