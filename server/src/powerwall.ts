import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Agent, fetch as undiciFetch } from 'undici';
import type { EnergyDay, GridState, PowerwallInfo, PowerwallSample } from './types.js';

/** Tesla Powerwall gateway, read over its local HTTPS API.
 *
 *  Uses the "customer" login (POST /api/login/Basic → Bearer token), which a
 *  Powerwall 3 still serves on its home-LAN address. Only three endpoints
 *  are needed and all three answer on PW3 firmware:
 *    /api/meters/aggregates          live flows + lifetime counters per meter
 *    /api/system_status/soe          battery state of charge
 *    /api/system_status/grid_status  on-grid / islanded
 *  (site_info, operation, system_status, powerwalls … 404 on PW3, and the
 *  richer TEDAPI needs the gateway's own Wi-Fi AP, so they're not used.) */

type RawMeter = {
  instant_power?: number;
  energy_exported?: number;
  energy_imported?: number;
  frequency?: number;
  instant_average_voltage?: number;
};
type RawAggregates = { site?: RawMeter; battery?: RawMeter; load?: RawMeter; solar?: RawMeter };

/** Lifetime meter counters, Wh. */
export type PowerwallCounters = {
  solarWh: number;
  homeWh: number;
  gridImportWh: number;
  gridExportWh: number;
  batteryChargeWh: number;
  batteryDischargeWh: number;
};

export type PowerwallReading = Omit<PowerwallInfo, 'today'> & { counters: PowerwallCounters | null };

const GRID_STATES: Record<string, GridState> = {
  SystemGridConnected: 'connected',
  SystemIslandedActive: 'islanded',
  SystemIslandedReady: 'islanded',
  SystemMicroGridFaulted: 'islanded',
  SystemWaitForUser: 'islanded',
  SystemTransitionToGrid: 'transition',
  SystemTransitionToIsland: 'transition',
};

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The gateway reports raw SoE including a 5% reserve the Tesla app hides;
 *  rescale so the kiosk and the app agree. */
export function appChargePct(raw: number): number {
  return Math.max(0, Math.min(100, (raw - 5) / 0.95));
}

export class PowerwallClient {
  private readonly base: string;
  private readonly agent: Agent;
  private token: string | null = null;
  /** One login at a time: poll() fires three requests in parallel, and the
   *  gateway answers concurrent logins with 429 and a lockout. */
  private loginInFlight: Promise<string> | null = null;
  /** After a failed login, fail fast until this time rather than retrying
   *  every poll — repeated attempts extend the gateway's rate-limit lockout. */
  private loginBlockedUntil = 0;

  constructor(private readonly opts: { host: string; email: string; password: string; insecureTls: boolean }) {
    this.base = `https://${opts.host}`;
    this.agent = new Agent({
      connect: { rejectUnauthorized: !opts.insecureTls },
      headersTimeout: 8_000,
      bodyTimeout: 8_000,
    });
  }

  /** A valid token, logging in (once, shared) if there isn't one. */
  private ensureToken(): Promise<string> {
    if (this.token) return Promise.resolve(this.token);
    if (this.loginInFlight) return this.loginInFlight;
    const wait = this.loginBlockedUntil - Date.now();
    if (wait > 0) return Promise.reject(new Error(`powerwall login backing off for ${Math.ceil(wait / 1000)}s`));
    this.loginInFlight = this.login()
      .then((t) => {
        this.token = t;
        this.loginBlockedUntil = 0;
        return t;
      })
      .catch((e: unknown) => {
        const limited = e instanceof Error && /HTTP 429/.test(e.message);
        this.loginBlockedUntil = Date.now() + (limited ? 300_000 : 60_000);
        throw e;
      })
      .finally(() => {
        this.loginInFlight = null;
      });
    return this.loginInFlight;
  }

  private async login(): Promise<string> {
    const res = await undiciFetch(`${this.base}/api/login/Basic`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'customer',
        email: this.opts.email,
        password: this.opts.password,
        force_sm_off: false,
      }),
      dispatcher: this.agent,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      // Never echo the body: a failed login response can include the email.
      throw new Error(`powerwall login failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { token?: string };
    if (!body.token) throw new Error('powerwall login failed: no token');
    return body.token;
  }

  private async get<T>(path: string): Promise<T> {
    const doFetch = (token: string) =>
      undiciFetch(`${this.base}${path}`, {
        headers: { authorization: `Bearer ${token}` },
        dispatcher: this.agent,
        signal: AbortSignal.timeout(8_000),
      });
    const used = await this.ensureToken();
    let res = await doFetch(used);
    if (res.status === 401 || res.status === 403) {
      // Tokens expire (and the gateway forgets them on reboot). Only the
      // first request to notice drops the token; the others reuse the
      // refreshed one instead of logging in again.
      if (this.token === used) this.token = null;
      res = await doFetch(await this.ensureToken());
    }
    if (!res.ok) throw new Error(`powerwall ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async poll(): Promise<PowerwallReading> {
    const [agg, soe, grid] = await Promise.all([
      this.get<RawAggregates>('/api/meters/aggregates'),
      this.get<{ percentage?: number }>('/api/system_status/soe'),
      this.get<{ grid_status?: string; grid_services_active?: boolean }>('/api/system_status/grid_status'),
    ]);
    const raw = n(soe.percentage);
    const gridRaw = grid.grid_status ?? null;
    const counters: PowerwallCounters | null =
      agg.solar && agg.load && agg.site && agg.battery
        ? {
            solarWh: n(agg.solar.energy_exported) ?? 0,
            homeWh: n(agg.load.energy_imported) ?? 0,
            gridImportWh: n(agg.site.energy_imported) ?? 0,
            gridExportWh: n(agg.site.energy_exported) ?? 0,
            batteryChargeWh: n(agg.battery.energy_imported) ?? 0,
            batteryDischargeWh: n(agg.battery.energy_exported) ?? 0,
          }
        : null;
    return {
      reachable: true,
      grid: gridRaw ? (GRID_STATES[gridRaw] ?? 'unknown') : 'unknown',
      gridStatusRaw: gridRaw,
      gridServicesActive: grid.grid_services_active === true,
      gridW: Math.round(n(agg.site?.instant_power) ?? 0),
      batteryW: Math.round(n(agg.battery?.instant_power) ?? 0),
      homeW: Math.max(0, Math.round(n(agg.load?.instant_power) ?? 0)),
      // Inverters draw a few watts at night, which reads as tiny negative solar.
      solarW: Math.max(0, Math.round(n(agg.solar?.instant_power) ?? 0)),
      chargePct: raw == null ? null : Math.round(appChargePct(raw) * 10) / 10,
      voltageV: n(agg.site?.instant_average_voltage),
      frequencyHz: n(agg.site?.frequency),
      updatedAt: Date.now(),
      counters,
    };
  }
}

// --- energy ledger ----------------------------------------------------------

const ENERGY_PATH = join(process.cwd(), 'data', 'energy.json');
const DAYS_KEPT = 31;
export const HISTORY_SAMPLES = 24 * 60;
/** A single poll can't plausibly move a counter this far (5s at 100 kW is
 *  ~140 Wh). Anything larger is a counter reset or a gateway swap: rebase
 *  on the new value instead of booking a fake spike. */
const MAX_DELTA_WH = 50_000;

type LedgerFile = {
  last: PowerwallCounters | null;
  days: Record<string, EnergyDay>;
  history: PowerwallSample[];
};

export function dayLabel(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function emptyDay(date: string): EnergyDay {
  return { date, solarWh: 0, homeWh: 0, gridImportWh: 0, gridExportWh: 0, batteryChargeWh: 0, batteryDischargeWh: 0 };
}

const COUNTER_KEYS: Array<keyof PowerwallCounters> = [
  'solarWh',
  'homeWh',
  'gridImportWh',
  'gridExportWh',
  'batteryChargeWh',
  'batteryDischargeWh',
];

/** Turns lifetime counters into per-day totals and live readings into
 *  one-minute averages, and persists both to data/energy.json so a restart
 *  (or a deb upgrade) keeps today's totals and the 24h curve. */
export class EnergyLedger {
  private state: LedgerFile;
  private dirty = false;
  private savedAt = 0;
  private minute: { start: number; n: number; solar: number; home: number; grid: number; battery: number; soc: number | null } | null =
    null;

  constructor() {
    this.state = EnergyLedger.load();
  }

  private static load(): LedgerFile {
    try {
      const parsed = JSON.parse(readFileSync(ENERGY_PATH, 'utf8')) as Partial<LedgerFile>;
      return { last: parsed.last ?? null, days: parsed.days ?? {}, history: parsed.history ?? [] };
    } catch {
      return { last: null, days: {}, history: [] };
    }
  }

  /** Book a counter reading into today's bucket. */
  addCounters(c: PowerwallCounters, now = new Date()): void {
    const date = dayLabel(now);
    const last = this.state.last;
    if (last) {
      const deltas = COUNTER_KEYS.map((k) => c[k] - last[k]);
      // A backwards or huge jump means the counters were reset; rebase.
      if (deltas.every((d) => d >= 0 && d <= MAX_DELTA_WH)) {
        const day = (this.state.days[date] ??= emptyDay(date));
        COUNTER_KEYS.forEach((k, i) => {
          day[k] += deltas[i]!;
        });
      }
    }
    this.state.last = { ...c };
    this.dirty = true;
  }

  /** Fold a live reading into the current minute; returns the finished
   *  average when the minute rolls over. */
  addReading(r: { solarW: number; homeW: number; gridW: number; batteryW: number; chargePct: number | null }, ts: number): PowerwallSample | null {
    const start = ts - (ts % 60_000);
    let done: PowerwallSample | null = null;
    const m = this.minute;
    if (m && m.start !== start && m.n > 0) {
      done = {
        ts: m.start,
        solarW: Math.round(m.solar / m.n),
        homeW: Math.round(m.home / m.n),
        gridW: Math.round(m.grid / m.n),
        batteryW: Math.round(m.battery / m.n),
        chargePct: m.soc,
      };
      this.state.history.push(done);
      if (this.state.history.length > HISTORY_SAMPLES) this.state.history.splice(0, this.state.history.length - HISTORY_SAMPLES);
      this.dirty = true;
    }
    if (!this.minute || this.minute.start !== start) {
      this.minute = { start, n: 0, solar: 0, home: 0, grid: 0, battery: 0, soc: null };
    }
    const cur = this.minute;
    cur.n += 1;
    cur.solar += r.solarW;
    cur.home += r.homeW;
    cur.grid += r.gridW;
    cur.battery += r.batteryW;
    if (r.chargePct != null) cur.soc = r.chargePct;
    return done;
  }

  today(now = new Date()): EnergyDay | null {
    if (!this.state.last) return null;
    const date = dayLabel(now);
    return this.state.days[date] ?? emptyDay(date);
  }

  /** Oldest first, trailing DAYS_KEPT days; prunes older buckets. */
  daily(): EnergyDay[] {
    const dates = Object.keys(this.state.days).sort();
    for (const stale of dates.slice(0, Math.max(0, dates.length - DAYS_KEPT))) delete this.state.days[stale];
    return dates.slice(-DAYS_KEPT).map((d) => ({ ...this.state.days[d]! }));
  }

  history(now = Date.now()): PowerwallSample[] {
    const cutoff = now - 24 * 3_600_000;
    return this.state.history.filter((s) => s.ts >= cutoff);
  }

  saveIfDue(now = Date.now(), everyMs = 60_000): void {
    if (!this.dirty || now - this.savedAt < everyMs) return;
    try {
      mkdirSync(dirname(ENERGY_PATH), { recursive: true });
      writeFileSync(ENERGY_PATH, JSON.stringify(this.state));
      this.savedAt = now;
      this.dirty = false;
    } catch (err) {
      console.error('[powerwall] failed to persist energy ledger:', err);
    }
  }
}
