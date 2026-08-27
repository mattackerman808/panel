# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A network monitoring dashboard for a UDM Pro Max, designed to run on a Raspberry Pi in Chromium kiosk mode. Two npm workspaces:

- `server/` — Fastify + native WS, polls the UDM and pushes ticks over `/ws`.
- `web/` — SvelteKit (static adapter, Svelte 5 runes) + Tailwind v4. Built output is served by the Fastify server in production; in dev it runs on Vite :5173 with `/api` and `/ws` proxied to :4000.

There is no test suite. `npm run typecheck` is the only check.

## Commands

Run from the repo root unless noted:

- `npm run dev` — runs server (`tsx watch`) and web (`vite dev`) concurrently. Open http://localhost:5173.
- `npm run build` — builds web first, then server. Output: `web/build/` and `server/dist/`.
- `npm run start` — runs the built server (`node server/dist/index.js`), which serves `web/build` from `/` plus `/api/*` and `/ws`.
- `npm run typecheck` — typechecks both workspaces.
- Workspace-scoped: `npm run dev -w @panel/server`, `npm run typecheck -w @panel/web`, etc.

The server reads `.env` from `process.cwd()`. Run dev/start from the repo root or it won't find it. See `.env.example` for the full set; UDM creds + SNMP config live there.

## Live vs. mock mode

`config.mock` is true when `PANEL_MOCK=1`, or when `UDM_HOST` is unset, or when neither `UDM_API_KEY` nor `UDM_USERNAME`/`UDM_PASSWORD` is set. Mock mode synthesizes WANs/clients/DPI/UDM stats so the UI is fully exercisable on a laptop with no UDM. The frontend shows the source as `live` or `mock` from the snapshot.

## Data flow

1. `server/src/poller.ts` runs one `tick()` every `PANEL_POLL_WAN_MS` (default 2s). Each tick:
   - Pulls SNMP counters for the WAN ifIndexes and computes bps deltas.
   - On slower cadences (clients/DPI/UDM info) calls the UniFi controller.
   - Writes everything into `store` via `store.pushTick()`.
2. `server/src/store.ts` holds the canonical state, trims per-WAN history to `PANEL_HISTORY_SAMPLES`, and fans the tick out to subscribed WS clients.
3. `server/src/server.ts` exposes `GET /api/snapshot`, `GET /api/health`, and a WS at `/ws` that sends one `snapshot` message on connect followed by `tick` messages.
4. `web/src/lib/store.svelte.ts` holds a Svelte 5 `$state` mirror of the server snapshot and applies tick deltas. Components in `web/src/lib/components/` read from it reactively.

Wire types live in **two** places that must stay in sync: `server/src/types.ts` and `web/src/lib/types.ts`. There is no shared package — if you change the wire format, update both.

## Why two UDM data sources

The UDM Pro Max exposes two APIs and the poller uses both deliberately:

- **SNMPv2c** — used for real-time WAN throughput. The legacy controller API caches WAN counters at ~30s, which is too slow for the bandwidth chart, so SNMP is the source of truth for `wans[].rxBps/txBps`.
- **Legacy controller API** (`UDM_USERNAME`/`UDM_PASSWORD`) — used for clients list, DPI categories, and gateway stats. The `/stat/sta` endpoint caches at ~30s; per-client rates are computed from byte deltas at a 60s poll interval (don't drop the poll below this — see the comment in `config.ts`). Without local creds, DPI and per-client rates are unavailable; the integration API key alone won't unlock them.
- The integration API key path exists but is feature-limited (`unifi.getMode() === 'integration'` disables DPI/per-client rates).

`store.features` advertises which subsystems are live so the UI can degrade gracefully.

## UPS power monitoring

`server/src/ups.ts` polls an optional network-managed UPS over SNMP (independent of the UDM — the UPS can be on a different subnet). It reads the vendor-neutral **UPS-MIB (RFC 1628)** and falls back to the **APC PowerNet MIB** per-field, so a partial-MIB UPS still yields whatever it implements. The whole read is one SNMP GET (SNMPv2c reports missing OIDs per-varbind, so requesting the union of both MIBs is safe). Enabled only when `UPS_HOST` is set; `store.features.upsAvailable` reflects that so the Power page can show "not configured" vs. "unreachable". Poll cadence is `PANEL_POLL_UPS_MS` (default 5s), on its own timer inside the tick. Reuses the generic `SnmpClient` from `snmp.ts` (`getValues()`), pointed at the UPS host. The normalized wire type is `UpsInfo` (in both `types.ts` files).

## Frontend specifics

- **Svelte 5 runes** — state classes use `$state(...)` (see `store.svelte.ts`, `theme.svelte.ts`). Don't reach for stores from `svelte/store`.
- **Themes** — two themes (`xbox`, `hud`) live in CSS custom properties under `[data-theme="..."]` (see `app.css`). `theme.svelte.ts` swaps `documentElement.dataset.theme`. Keyboard: `t`/`T` cycles, `1-9` jumps. New themes go in `THEMES`, `THEME_LABELS`, and the CSS.
- **Page cycling** — `+page.svelte` auto-cycles 6 pages every 30s (Network, Clients, Layer 2, Switch Detail, Topology, Power/UPS). Keys: `←`/`→` step, `Space`/`P` pause the auto-cycle. `HotkeyBar.svelte` renders the always-visible legend under the header (incl. the Ctrl+Alt+K desktop break-out).
- **Burn-in guard** (`web/src/lib/burnInGuard.ts`) — periodically translates `.panel-root` by a few pixels and cycles the theme so static bright UI doesn't burn into the kiosk LCD. All themes must have similar animation cost; a previous "matrix" theme was dropped because it was too expensive during the cycle.
- The page is one route (`+page.svelte`) — this is a single-screen kiosk dashboard, not a multi-page app.

## Packaging (Debian / apt — Salt-driven installs)

The app ships as a Debian package `panel`, built and published the same way as the `salt-808` package in `~/git/salt` (that repo is the reference for the house convention).

- `make deb [VERSION=…]` builds `build/panel_<version>_all.deb`: `npm ci && npm run build`, then stages the app under `/opt/panel` (`server/dist`, `web/build`, and a **standalone prod-only `node_modules`** installed from `server/package.json` — the web build-time deps like fonts/d3/elk are excluded, keeping the deb ~3 MB and `Architecture: all` since every runtime dep is pure JS/wasm).
- `make publish` uploads it via `curl -H "Authorization: Bearer $REPO_API_KEY"` to `$REPO_URL` (default `http://apt.808.org/upload`).
- CI: `.github/workflows/publish.yml` builds + publishes on push to `main` (date-stamped version `YY.M.D.<run>`), mirroring salt-808. Runs on `ubuntu-latest` (salt-808 reaches apt.808.org from there); swap `runs-on` for a self-hosted runner label if preferred. Needs the `REPO_API_KEY` repo secret.
- Package layout: app at `/opt/panel`, unit `/lib/systemd/system/panel.service` (runs as the `panel` system user, `WorkingDirectory=/var/lib/panel`, `EnvironmentFile=/etc/panel/panel.env`), state in `/var/lib/panel/data`. `postinst` creates the user/dirs and installs `/etc/panel/panel.env` from `/usr/share/panel/panel.env.example` **only if absent**, so Salt can own that file without upgrade clobber. Static packaging tree is `packaging/panel/`; the version placeholder in `DEBIAN/control` is `{{VERSION}}`.

Salt then consumes it (wired in `~/git/salt`, not here): `pkgrepo.managed` for apt.808.org + `pkg.installed: panel` + `file.managed: /etc/panel/panel.env` from pillar + `service.running: panel`.

## Deployment (VM / web app)

`deploy/install-vm.sh` installs the server as a plain web service (no kiosk display): builds, writes `panel-vm.service` (binds `127.0.0.1:4000`, `ProtectSystem=strict` with `data/` writable), enables it, and prints reverse-proxy next steps. Put a reverse proxy in front for TLS + a hostname — configs in `deploy/reverse-proxy/`: `Caddyfile` (auto-TLS, transparent WebSockets — the easy path) and `apache-panel.conf` (needs `mod_proxy_wstunnel`; `/ws` must be `ProxyPass`ed as `ws://` **before** the `/` catch-all). The VM must be able to route to the UDM (SNMP + legacy API) and the UPS (SNMP), or the poller degrades. Containerizing for the Kube cluster is the intended later step; this VM path is the interim host.

## Deployment (Pi kiosk)

Two installers. `deploy/install.sh` builds and installs `panel.service` (systemd) — the server on port 4000. `deploy/install-plasma-kiosk.sh` sets up the display side on a Pi 5 (Pi OS / Debian trixie): SDDM autologin → **KDE Plasma (Wayland)** → the Chromium kiosk fullscreen. (This replaced an earlier labwc/wayfire setup; `deploy/kiosk-toggle.sh` is the labwc-era toggle, kept only for that rollback path.)

Kiosk display chain, all in `deploy/`:
- `kiosk.sh` — waits for `/api/health`, then exec's Chromium `--kiosk` as an **XWayland** client (`--ozone-platform=x11`, so `unclutter` can hide the cursor), wrapped in `kde-inhibit --screenSaver --power` so KDE never blanks or locks the screen while the kiosk runs.
- `kiosk-respawn.sh` — compositor-agnostic respawn loop (replaces Pi OS's `lwrespawn`, which only loops under labwc); relaunches Chromium on crash. Launched from `~/.config/autostart/panel-kiosk.desktop`.
- `panel-toggle.sh` — bound to **Ctrl+Alt+K** (a `kglobalshortcutsrc` `[services]` launch entry — KWin owns global shortcuts on Plasma 6) and exposed as a desktop icon. Kills the kiosk (respawn wrapper + browser) to drop to a clean Plasma desktop, and relaunches on the next toggle. Do **not** use KWin "Show Desktop" for this — minimize is wrong for a fullscreen kiosk (it pops back when another window opens).

`deploy/tmpfiles-panel-fan.conf` persists quieter pwm-fan trip points across reboots.
