# Changelog

Package versions are date-stamped by CI (`YY.M.D.<run>`); entries below group the changes that shipped together.

## 26.10.6 — Dashboard redesign (2026-10-05)

A rebuild of the UI as an operations display, with the server extended to feed it.

### Dashboard
- Persistent status bar: feed state, live download/upload per WAN with latency, clients (wired/wifi), devices online, PoE draw vs budget, UPS state, alert count, clock.
- Attention strip: derived alerts (device offline, WAN down/degraded/slow, saturated link, congested 5/6 GHz radio, PoE near budget, UPS on battery, controller/SNMP outage) shown above whichever page is up; absent when all is clear.
- Seven labeled pages with a dwell progress line instead of anonymous dots: Overview, Internet, Wired, Wireless, Clients, Topology, Power. Rotation order and dwell via `PANEL_UI_PAGES` / `PANEL_UI_DWELL_MS` or `?pages=&dwell=`; `?page=` pins one page, `?start=` begins on one.
- Wired: one row per switch with a port map (fill = negotiated speed, ring = uplink, dot = PoE, tick = errors), uplink utilization, throughput, PoE meter, CPU, temperature, uptime; busiest links by utilization; PoE headroom per switch.
- Wireless: one row per AP with clients per band, channel/width/airtime meter per band, retries, experience, uplink; busiest wireless clients with signal bars; channel plan per band.
- Internet: per-WAN detail (latency trend, availability, controller probes, IPs, uptime, drops, speedtest, 31-day daily usage) plus top applications and categories.
- Clients: top talkers, heaviest sessions, population by network, recently joined.
- Topology: left-to-right LLDP graph, link width and color by utilization.
- Power: UPS source, load, charge, runtime, electrical detail, last-hour load / line voltage / output power.
- Design system: IBM Plex type, `rem` sizing off a viewport-scaled root (1080p to 4K), hairline panels, one accent, fixed data colors (download `#2d96dd`, upload `#bf8526`) validated for color-vision separation, reserved status colors always paired with a label. Themes reduced to graphite, arctic, ember (planes and accent only). HUD chrome (chamfers, glows, scanlines, noise) removed.
- Kiosk auto-reload: the page reloads itself when it reconnects to a restarted server, so upgrades reach the screen unattended.
- Alert thresholds live in `web/src/lib/derive.ts`; 2.4 GHz radios are excluded from airtime/retry alerts by default.

### Server
- Histories kept server-side and sent on connect: WAN throughput (15 min), device, gateway and UPS samples (1 h).
- Per-day WAN usage for 31 days, persisted with the month-to-date counters; today's usage on each WAN.
- Persisted event log (device offline/online/firmware, WAN down/up/public IP change, UPS battery/mains/unreachable, controller and SNMP outages, server start), shipped incrementally in ticks.
- Clients merge the v2 list with legacy `/stat/sta`: AP / switch-port / radio / channel / SSID / network association, PHY rates, experience, uptime, guest flag.
- Devices merge v2 with legacy `/stat/device`: PoE wattage and budget, port error/drop counters, media, STP state, LLDP, VAP-derived per-band client counts, firmware, upgradable flag, fan/overheat. The legacy device list is cached per poll cycle.
- WAN entries carry controller health (ISP, ASN, availability, probes, uptime, drops), a `degraded` status, and a link speed from `UDM_WAN_SPEEDS` or the controller's negotiated port speed (SNMP ifHighSpeed is unreliable on some ports).
- Model codes resolve to product names (`server/src/catalog.ts`).
- Feature flags gain `controllerAvailable` and are pushed when they change.
- Mock mode is a time-deterministic fleet modeled on the real site with replayed history, daily usage, seeded events, a periodically flapping switch and a congested radio.
- Wire types are defined once in `server/src/types.ts`; the web app re-exports them.

### Configuration
- New: `PANEL_SITE_NAME`, `PANEL_UI_PAGES`, `PANEL_UI_DWELL_MS`, `UDM_WAN_SPEEDS`, `PANEL_HISTORY_DEVICE_SAMPLES`; `PANEL_HISTORY_SAMPLES` default 450.
- Dev: `PANEL_UPSTREAM` points the Vite proxy at a deployed panel.
- `data/` now holds `events.json` alongside `monthly.json` (which gains per-day buckets; existing files migrate in place).

## 26.8.27 — Packaging, VM hosting, UPS (2026-08-27)

- Debian package (`make deb`) published to the 808 apt repo by CI; Salt-driven install under `/opt/panel` with `/etc/panel/panel.env`.
- VM hosting path with a reverse proxy (Caddy / Apache, WebSocket at `/ws`).
- UPS monitoring over SNMP (RFC 1628 UPS-MIB with CyberPower and APC fallbacks) and a Power page.
- Poller recovers from a dead start (SNMP discovery and controller connection retried on a timer).
- Self-healing WAN detection via the controller's WAN1/WAN2 designation with a public-IP fallback; LLDP backfill from the legacy device endpoint; per-WAN ISP/ASN/IPv6, monthly usage and probe latencies.
- Theme refresh; Pi kiosk moved to KDE Plasma with a desktop toggle.
