# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A network operations dashboard for a UDM Pro Max site, designed to run on a Raspberry Pi in Chromium kiosk mode (and, behind a reverse proxy, as a web app). Two npm workspaces:

- `server/` — Fastify + native WS, polls the UDM and an optional UPS, keeps state + short histories + an event log, and pushes ticks over `/ws`.
- `web/` — SvelteKit (static adapter, Svelte 5 runes) + Tailwind v4. Built output is served by the Fastify server in production; in dev it runs on Vite :5173 with `/api` and `/ws` proxied to :4000.

There is no test suite. `npm run typecheck` is the only check.

## Commands

Run from the repo root unless noted:

- `npm run dev` — runs server (`tsx watch`) and web (`vite dev`) concurrently. Open http://localhost:5173.
- `npm run build` — builds web first, then server. Output: `web/build/` and `server/dist/`.
- `npm run start` — runs the built server (`node server/dist/index.js`), which serves `web/build` from `/` plus `/api/*` and `/ws`.
- `npm run typecheck` — typechecks both workspaces.
- Workspace-scoped: `npm run dev -w @panel/server`, `npm run typecheck -w @panel/web`, etc.
- `PANEL_UPSTREAM=https://panel.example.org npm run dev -w @panel/web` — develop the UI against a deployed panel (the Vite proxy targets it instead of localhost:4000). No credentials needed locally; new server-side fields will simply be absent until that host is upgraded.

The server reads `.env` from `process.cwd()`. Run dev/start from the repo root or it won't find it. See `.env.example` for the full set; UDM creds + SNMP config live there.

## Live vs. mock mode

`config.mock` is true when `PANEL_MOCK=1`, or when `UDM_HOST` is unset, or when neither `UDM_API_KEY` nor `UDM_USERNAME`/`UDM_PASSWORD` is set. Mock mode (`server/src/mock.ts`) synthesizes a fleet modeled on the real site — gateway + cable modem, `agg` → `core`/`cabinet` → seven leaf switches, six APs, ~85 clients cabled to real ports, a UPS — as a **pure function of time**, so the poller replays the last 15 minutes at startup to pre-fill every history. It also flaps one switch (`bnlsw`, 50s every 20 min) and congests one 2.4 GHz radio periodically so the attention strip and event log get exercised. Keep new mock data deterministic in `t` (hash-based jitter, no `Math.random`) or the backfill and live ticks disagree.

## Data flow

1. `server/src/poller.ts` runs one `tick()` every `PANEL_POLL_WAN_MS` (default 2s). Each tick:
   - Pulls SNMP counters for the WAN ifIndexes and computes bps deltas; adds the deltas to the month-to-date and per-day usage buckets (persisted to `data/monthly.json`, 31 days kept).
   - On slower cadences (clients 60s, DPI 60s, devices/gateway/health/WAN details 15s, UPS 5s) calls the UniFi controller / UPS.
   - Folds controller health (ISP, ASN, availability, probes) into each `Wan` so the UI never correlates `health[]` by name.
   - Writes everything into `store` via `store.pushTick()`.
2. `server/src/store.ts` holds the canonical state, trims histories (WAN: `PANEL_HISTORY_SAMPLES`; device/gateway/UPS: `PANEL_HISTORY_DEVICE_SAMPLES`), **diffs the previous and next state to raise events** (device offline/online/firmware, WAN down/up/IP change, UPS battery/mains/unreachable), and fans the tick out to subscribed WS clients. `store.recordEvent()` is for events raised outside the tick (controller/SNMP outages, server start). `server/src/events.ts` persists the log to `data/events.json`.
3. `server/src/server.ts` exposes `GET /api/snapshot`, `GET /api/health`, and a WS at `/ws` that sends one `snapshot` message on connect followed by `tick` messages. Ticks carry only what changed (`deviceSamples`, `gatewaySample`, `upsSample`, `events`, `features`, `usageDaily` are optional).
4. `web/src/lib/store.svelte.ts` holds a Svelte 5 `$state` mirror of the server snapshot and applies tick deltas. Every field added after the first release is defaulted there so an older server still drives the UI. The snapshot carries a `buildId` that changes on every server (re)start; when a reconnecting client sees a new one it reloads the page, so a deb upgrade reaches the kiosk screen without touching the Pi (in dev, every `tsx watch` restart therefore reloads the browser too).

Wire types live in **one** place: `server/src/types.ts`. `web/src/lib/types.ts` is a type-only re-export (`export type *`), erased at build time. All rate fields named `*Bps` are **bytes** per second; the UI multiplies by 8.

## Why two UDM data sources

The UDM Pro Max exposes two APIs and the poller uses both deliberately:

- **SNMPv2c** — used for real-time WAN throughput. The legacy controller API caches WAN counters at ~30s, which is too slow for the bandwidth chart, so SNMP is the source of truth for `wans[].rxBps/txBps` and the usage accumulators.
- **Legacy controller API** (`UDM_USERNAME`/`UDM_PASSWORD`) — used for clients, DPI, device detail and health. The `/stat/sta` endpoint caches at ~30s; per-client rates are computed from byte deltas at a 60s poll interval (don't drop the poll below this — see the comment in `config.ts`). Clients are fetched from **both** `/v2/api/site/{site}/clients/active` (display names, vendor, fingerprint) and legacy `/stat/sta` (AP mac, switch port, radio, SSID, network) and merged by MAC in `UnifiClient.toClient`; either side alone still works. Devices likewise merge `/v2/api/site/{site}/device` with legacy `/stat/device` (PoE wattage, port error counters, LLDP table, PoE budget, VAP client counts); the legacy device list is fetched once per cycle and cached 5s because three pollers read it.
- The integration API key path exists but is feature-limited (`unifi.getMode() === 'integration'` disables DPI/per-client rates/device detail).

`store.features` advertises which subsystems are live (`controllerAvailable`, `snmpAvailable`, `dpiAvailable`, `perClientRates`, `upsAvailable`) so the UI can degrade gracefully; feature changes ship in the next tick.

Model codes → product names live in `server/src/catalog.ts` (`modelName()`); add codes as new hardware shows up (unknown codes fall back to the raw code).

## UPS power monitoring

`server/src/ups.ts` polls an optional network-managed UPS over SNMP (independent of the UDM — the UPS can be on a different subnet). It reads the vendor-neutral **UPS-MIB (RFC 1628)** and falls back to the **CyberPower** and **APC PowerNet** MIBs per-field, so a partial-MIB UPS still yields whatever it implements. Enabled only when `UPS_HOST` is set; `store.features.upsAvailable` reflects that so the Power page can show "not configured" vs. "unreachable". Poll cadence is `PANEL_POLL_UPS_MS` (default 5s), on its own timer inside the tick; the UPS history is subsampled to 15s. The normalized wire type is `UpsInfo`.

## Frontend

- **Shell** (`web/src/routes/+page.svelte`): a non-scrolling grid — `TopBar` (site, feed state, live WAN rates, clients/devices/PoE/power, alert count, clock), `AlertStrip` (only rendered when `deriveAlerts()` returns something), the page stage, and `PageBar` (labeled tabs with a dwell progress line + keyboard legend). All pages stay mounted and crossfade; `ThroughputChart` draws one frame while its page is hidden and 30 fps while visible.
- **Pages** (`web/src/lib/pages/`): overview, internet, wired, wireless, clients, topology, power. Rotation order/dwell come from `?pages=`/`?dwell=` on the URL, else the server's `PANEL_UI_PAGES`/`PANEL_UI_DWELL_MS`, else the default order; `?page=x` pins one page (paused). The power page registers an `available()` guard (needs `features.upsAvailable`). Keys: `←`/`→` step, `space`/`p` pause, `1–9` jump, `t` cycles themes.
- **Components** (`web/src/lib/components/`): `Panel` (title + meta + body), `Stat`, `Sparkline` (SVG, container-sized), `Meter` (fill = severity, track = faint same color), `PortStrip` (one cell per switch port: fill = speed tier, ring = uplink, dot = PoE, red tick = errors), `ThroughputChart` (canvas), `UsageBars` (daily stacked columns), `RankedBars` (one-hue ranked list), `EventList`, `WanCard`, `TopologyView` (elkjs layered layout; re-laid out only when the structure changes).
- **Derivations** (`web/src/lib/derive.ts`): `deriveAlerts()` and its `THRESHOLDS` (edit thresholds there, nowhere else), `fleetSummary()`, `deriveLinks()` (inter-device links with utilization), state/band labels, signal helpers. Pure functions over the store; keep view logic out of components when it's reusable.
- **Design tokens** (`web/src/app.css`): planes `--bg/--surface/--surface-2/--surface-3`, hairlines `--line/--line-strong`, ink `--ink/--ink-2/--ink-3`, UI accent `--accent`, data series `--rx` (download, `#2d96dd`) / `--tx` (upload, `#bf8526`), status `--ok/--warn/--crit`. Three themes (`graphite` default, `arctic`, `ember`) change planes + accent only — data and status colors are fixed because they carry meaning. The series pair was chosen to pass a color-vision validator on the dark surface; don't re-tint it casually. Type: IBM Plex Sans (UI), Plex Sans Condensed (figures/headings), Plex Mono (addresses, columns). Everything is sized in `rem`; `html { font-size: clamp(13px, 0.8vw, 26px) }` scales the composition from 1080p to 4K. Status colors never carry meaning alone (always a label/pill); text never wears a series color (a colored glyph or swatch sits beside ink text).
- **Burn-in guard** (`web/src/lib/burnInGuard.ts`) — translates `.panel-root` by a few pixels every three minutes.
- Layouts are CSS grid with `minmax(0, …fr)` rows so every page fits the viewport without scrolling; panels have `overflow: hidden`. When adding rows to a table, check it still fits at 1920×1080 with the real fleet size (10 switches, 6 APs).

## Packaging (Debian / apt — Salt-driven installs)

The app ships as a Debian package `panel`, built and published the same way as the `salt-808` package in `~/git/salt` (that repo is the reference for the house convention).

- `make deb [VERSION=…]` builds `build/panel_<version>_all.deb`: `npm ci && npm run build`, then stages the app under `/opt/panel` (`server/dist`, `web/build`, and a **standalone prod-only `node_modules`** installed from `server/package.json` — the web build-time deps like fonts/elk are excluded, keeping the deb ~3 MB and `Architecture: all` since every runtime dep is pure JS/wasm).
- `make publish` uploads it via `curl -H "Authorization: Bearer $REPO_API_KEY"` to `$REPO_URL` (default `http://apt.808.org/upload`).
- CI: `.github/workflows/publish.yml` builds + publishes on push to `main` (date-stamped version `YY.M.D.<run>`), mirroring salt-808. Runs on `ubuntu-latest` (salt-808 reaches apt.808.org from there); swap `runs-on` for a self-hosted runner label if preferred. Needs the `REPO_API_KEY` repo secret.
- Package layout: app at `/opt/panel`, unit `/lib/systemd/system/panel.service` (runs as the `panel` system user, `WorkingDirectory=/var/lib/panel`, `EnvironmentFile=/etc/panel/panel.env`), state in `/var/lib/panel/data` (`monthly.json`, `events.json`). `postinst` creates the user/dirs and installs `/etc/panel/panel.env` from `/usr/share/panel/panel.env.example` **only if absent**, so Salt can own that file without upgrade clobber. Static packaging tree is `packaging/panel/`; the version placeholder in `DEBIAN/control` is `{{VERSION}}`.

Salt then consumes it (wired in `~/git/salt`, not here): `pkgrepo.managed` for apt.808.org + `pkg.installed: panel` + `file.managed: /etc/panel/panel.env` from pillar + `service.running: panel`. New display settings for the live site (`PANEL_SITE_NAME`, `PANEL_UI_PAGES`, `PANEL_UI_DWELL_MS`, `UDM_WAN_SPEEDS`) go in that pillar.

## Deployment (VM / web app)

`deploy/install-vm.sh` installs the server as a plain web service (no kiosk display): builds, writes `panel-vm.service` (binds `127.0.0.1:4000`, `ProtectSystem=strict` with `data/` writable), enables it, and prints reverse-proxy next steps. Put a reverse proxy in front for TLS + a hostname — configs in `deploy/reverse-proxy/`: `Caddyfile` (auto-TLS, transparent WebSockets — the easy path) and `apache-panel.conf` (needs `mod_proxy_wstunnel`; `/ws` must be `ProxyPass`ed as `ws://` **before** the `/` catch-all). The VM must be able to route to the UDM (SNMP + legacy API) and the UPS (SNMP), or the poller degrades. Containerizing for the Kube cluster is the intended later step; this VM path is the interim host.

## Deployment (Pi kiosk)

Two installers. `deploy/install.sh` builds and installs `panel.service` (systemd) — the server on port 4000. `deploy/install-plasma-kiosk.sh` sets up the display side on a Pi 5 (Pi OS / Debian trixie): SDDM autologin → **KDE Plasma (Wayland)** → the Chromium kiosk fullscreen. (This replaced an earlier labwc/wayfire setup; `deploy/kiosk-toggle.sh` is the labwc-era toggle, kept only for that rollback path.)

Kiosk display chain, all in `deploy/`:
- `kiosk.sh` — waits for `/api/health`, then exec's Chromium `--kiosk` as an **XWayland** client (`--ozone-platform=x11`, so `unclutter` can hide the cursor), wrapped in `kde-inhibit --screenSaver --power` so KDE never blanks or locks the screen while the kiosk runs. The URL carries `?kiosk=1`; add `&pages=…&dwell=…` or `&page=…` there for per-screen rotations.
- `kiosk-respawn.sh` — compositor-agnostic respawn loop (replaces Pi OS's `lwrespawn`, which only loops under labwc); relaunches Chromium on crash. Launched from `~/.config/autostart/panel-kiosk.desktop`.
- `panel-toggle.sh` — bound to **Ctrl+Alt+K** (a `kglobalshortcutsrc` `[services]` launch entry — KWin owns global shortcuts on Plasma 6) and exposed as a desktop icon. Kills the kiosk (respawn wrapper + browser) to drop to a clean Plasma desktop, and relaunches on the next toggle. Do **not** use KWin "Show Desktop" for this — minimize is wrong for a fullscreen kiosk (it pops back when another window opens).

`deploy/tmpfiles-panel-fan.conf` persists quieter pwm-fan trip points across reboots.
