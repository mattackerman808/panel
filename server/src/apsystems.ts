import { fetch as undiciFetch } from 'undici';
import type { MicroinverterChannel, MicroinverterInfo } from './types.js';

/** APsystems EZ1 plug-in microinverter, read over its local HTTP API.
 *
 *  The API only exists once "Local Mode" is switched on (AP EasyPower app →
 *  Direct Connection over Bluetooth → Settings → Local Mode, Continuous);
 *  it then serves unauthenticated JSON on :8050. Only the read endpoints
 *  are used — setMaxPower / setOnOff exist but the kiosk is read-only:
 *    /getDeviceInfo   model ("EZ1-LV 1.1.8"), serial, rated min/max power
 *    /getOutputData   p1/p2 live W, e1/e2 kWh since startup, te1/te2 lifetime kWh
 *    /getAlarm        og (off-grid), isce1..4 (DC input short), oe (output fault)
 *    /getOnOff        status "0" = output on, "1" = off
 *
 *  The inverter is powered by its panels, so it disappears from the network
 *  every night. e1/e2 reset when it powers up, which is *usually* the
 *  morning but also after a long cloud; daily energy is therefore taken
 *  from deltas of the lifetime counters (EnergyLedger.addPlugIn), never
 *  from e1/e2. Replies take 0.6–2 s over Wi-Fi, so requests to one
 *  inverter are made one at a time.
 *
 *  Not answering is a normal state, not an error: the inverter powers off
 *  whenever its panels do (night, heavy shade, a panel unplugged). poll()
 *  never throws, a silent inverter reads as 0 W / unreachable, and nothing
 *  downstream (events, alerts) treats that as a fault. Its power-up and
 *  power-down are noisy too, so alarms and "output off" are only reported
 *  once it has been awake for WAKE_GRACE_MS and the same flag has been read
 *  twice in a row. */

type Envelope<T> = { data?: T; message?: string; deviceId?: string };
type RawInfo = { deviceId?: string; devVer?: string; minPower?: string; maxPower?: string };
type RawOutput = { p1?: number; e1?: number; te1?: number; p2?: number; e2?: number; te2?: number };
type RawAlarm = Record<string, string>;

const ALARMS: Record<string, string> = {
  og: 'off-grid',
  isce1: 'DC input 1 short circuit',
  isce2: 'DC input 2 short circuit',
  isce3: 'DC input 3 short circuit',
  isce4: 'DC input 4 short circuit',
  oe: 'output fault',
};

const n = (v: unknown): number | null => {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
};

/** Device info and alarms change rarely; refresh them on this cadence. */
const SLOW_MS = 60_000;
/** Once it stops answering (dusk), probe at this pace instead of every poll. */
const ASLEEP_RETRY_MS = 60_000;
const TIMEOUT_MS = 9_000;
/** Ignore alarm / output flags for this long after it starts answering. */
const WAKE_GRACE_MS = 5 * 60_000;

export type Ez1Reading = { info: MicroinverterInfo; lifetimeWh: number | null };

export class Ez1Client {
  private readonly base: string;
  private info: MicroinverterInfo;
  private slowAt = 0;
  private retryAt = 0;
  private busy = false;
  /** When it last started answering; null while asleep. */
  private awakeSince: number | null = null;
  /** Previous raw read of the alarm / output flags, for the debounce. */
  private lastAlarms = new Set<string>();
  private lastOn: boolean | null = null;

  constructor(opts: { host: string; port: number; name: string }) {
    this.base = `http://${opts.host}:${opts.port}`;
    this.info = {
      id: opts.host,
      name: opts.name,
      host: opts.host,
      reachable: false,
      model: null,
      firmware: null,
      maxPowerW: null,
      powerW: 0,
      channels: [],
      todayWh: null,
      outputOn: null,
      alarms: [],
      updatedAt: null,
    };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await undiciFetch(`${this.base}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`ez1 ${path}: HTTP ${res.status}`);
    const body = (await res.json()) as Envelope<T>;
    if (body.message !== 'SUCCESS' || !body.data) throw new Error(`ez1 ${path}: ${body.message ?? 'no data'}`);
    return body.data;
  }

  /** Current view, without polling. */
  current(): MicroinverterInfo {
    return this.info;
  }

  /** Poll once. Returns null when skipped (a poll still in flight, or
   *  waiting out the overnight retry interval). Never throws. */
  async poll(now = Date.now()): Promise<Ez1Reading | null> {
    if (this.busy || now < this.retryAt) return null;
    this.busy = true;
    try {
      const out = await this.get<RawOutput>('/getOutputData');
      if (now - this.slowAt >= SLOW_MS) {
        this.slowAt = now;
        // Sequential on purpose: the inverter's web server is tiny.
        const dev = await this.get<RawInfo>('/getDeviceInfo').catch(() => null);
        const alarm = await this.get<RawAlarm>('/getAlarm').catch(() => null);
        const onOff = await this.get<{ status?: string }>('/getOnOff').catch(() => null);
        if (dev) {
          const [model, firmware] = (dev.devVer ?? '').split(/\s+/, 2);
          this.info.id = dev.deviceId || this.info.id;
          this.info.model = model || null;
          this.info.firmware = firmware || null;
          this.info.maxPowerW = n(dev.maxPower);
        }
        // Debounce: a flag counts once it has been read twice in a row, and
        // only after the wake-up grace period.
        const settled = this.awakeSince != null && now - this.awakeSince >= WAKE_GRACE_MS;
        if (alarm) {
          const raw = Object.entries(alarm)
            .filter(([, v]) => v === '1')
            .map(([k]) => ALARMS[k] ?? k);
          this.info.alarms = settled ? raw.filter((a) => this.lastAlarms.has(a)) : [];
          this.lastAlarms = new Set(raw);
        }
        if (onOff?.status != null) {
          const on = onOff.status === '0';
          // "On" is believed at once; "off" only when settled and read twice.
          if (on) this.info.outputOn = true;
          else if (settled && this.lastOn === false) this.info.outputOn = false;
          this.lastOn = on;
        }
      }
      const te1 = (n(out.te1) ?? 0) * 1000;
      const te2 = (n(out.te2) ?? 0) * 1000;
      // A zero total is a boot-time placeholder, not a real lifetime counter.
      const lifetime = te1 + te2 > 0 ? te1 + te2 : null;
      const channels: MicroinverterChannel[] = [
        { powerW: Math.max(0, Math.round(n(out.p1) ?? 0)), lifetimeWh: Math.round(te1) },
        { powerW: Math.max(0, Math.round(n(out.p2) ?? 0)), lifetimeWh: Math.round(te2) },
      ];
      if (!this.info.reachable) {
        console.log(`[apsystems] ${this.info.name} awake`);
        this.awakeSince = now;
      }
      this.info = {
        ...this.info,
        reachable: true,
        powerW: channels.reduce((a, c) => a + c.powerW, 0),
        channels,
        updatedAt: now,
      };
      return { info: this.info, lifetimeWh: lifetime };
    } catch (e) {
      // Expected every evening (and whenever the panels lose power): one
      // info line on the transition, nothing per retry.
      if (this.info.reachable) console.log(`[apsystems] ${this.info.name} asleep (not answering: ${e instanceof Error ? e.message : e})`);
      this.awakeSince = null;
      this.lastAlarms = new Set();
      this.lastOn = null;
      this.info = {
        ...this.info,
        reachable: false,
        powerW: 0,
        channels: this.info.channels.map((c) => ({ ...c, powerW: 0 })),
        alarms: [],
        outputOn: null,
      };
      this.retryAt = now + ASLEEP_RETRY_MS;
      this.slowAt = 0;
      return { info: this.info, lifetimeWh: null };
    } finally {
      this.busy = false;
    }
  }
}
