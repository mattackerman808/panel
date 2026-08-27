import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadDotEnv(): void {
  try {
    const path = join(process.cwd(), '.env');
    const text = readFileSync(path, 'utf8');
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // .env is optional
  }
}

loadDotEnv();

function bool(v: string | undefined, def = false): boolean {
  if (v === undefined) return def;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

function num(v: string | undefined, def: number): number {
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const mockEnv = bool(process.env.PANEL_MOCK, false);
const hasApiKey = !!process.env.UDM_API_KEY;
const hasUserPass = !!process.env.UDM_USERNAME && !!process.env.UDM_PASSWORD;
const hasHost = !!process.env.UDM_HOST;

export const config = {
  port: num(process.env.PORT, 4000),
  host: process.env.HOST ?? '0.0.0.0',
  mock: mockEnv || !hasHost || (!hasApiKey && !hasUserPass),
  udm: {
    host: process.env.UDM_HOST ?? '',
    apiKey: process.env.UDM_API_KEY ?? '',
    username: process.env.UDM_USERNAME ?? '',
    password: process.env.UDM_PASSWORD ?? '',
    site: process.env.UDM_SITE ?? 'default',
    insecureTls: bool(process.env.UDM_INSECURE_TLS, true),
  },
  // UPS power monitoring over SNMP (vendor-neutral RFC 1628 UPS-MIB, with
  // an APC PowerNet fallback). Disabled unless UPS_HOST is set. Runs
  // independently of the UDM subsystems — a UPS on a different subnet is
  // fine as long as the server can route to it.
  ups: {
    enabled: !!process.env.UPS_HOST,
    host: process.env.UPS_HOST ?? '',
    community: process.env.UPS_SNMP_COMMUNITY ?? 'public',
    port: num(process.env.UPS_SNMP_PORT, 161),
  },
  snmp: {
    community: process.env.UDM_SNMP_COMMUNITY ?? 'public',
    port: num(process.env.UDM_SNMP_PORT, 161),
    wanIfIndexes: (process.env.UDM_WAN_IFINDEXES ?? '')
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0),
    wanLabels: (process.env.UDM_WAN_LABELS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  },
  poll: {
    wanMs: num(process.env.PANEL_POLL_WAN_MS, 2000),
    // UDM controller caches /stat/sta responses for ~30s, so polling at
    // exactly 30s races the cache and yields zero deltas. 60s gives the
    // cache room to refresh; per-client rates become a 60s rolling avg.
    clientsMs: num(process.env.PANEL_POLL_CLIENTS_MS, 60000),
    dpiMs: num(process.env.PANEL_POLL_DPI_MS, 60000),
    udmInfoMs: num(process.env.PANEL_POLL_UDM_MS, 15000),
    // UPS SNMP is cheap and the interesting events (load spikes, transfer
    // to battery) are fast, so poll at 5s. The UPS agent is on a separate
    // host from the UDM, so this cadence is independent of the WAN tick.
    upsMs: num(process.env.PANEL_POLL_UPS_MS, 5000),
    // How often to re-attempt a subsystem that came up dead. The Pi can
    // start panel.service before eth0 has an address, which used to leave
    // the poller WAN-less (and every chart blank) until a manual restart.
    recoveryMs: num(process.env.PANEL_POLL_RECOVERY_MS, 30000),
  },
  history: {
    maxSamples: num(process.env.PANEL_HISTORY_SAMPLES, 180),
  },
  webDistPath: process.env.PANEL_WEB_DIST ?? '../web/build',
};

export type Config = typeof config;
