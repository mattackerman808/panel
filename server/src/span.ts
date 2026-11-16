import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import mqtt, { type MqttClient } from 'mqtt';
import { fetch as undiciFetch } from 'undici';
import type { SpanBackup, SpanCircuit, SpanInfo } from './types.js';

/** SPAN smart panel over its local v2 API (spanio/SPAN-API-Client-Docs).
 *
 *  REST is only used to get in, and needs no auth: `GET /api/v2/status`
 *  for the serial and `GET /api/v2/certificate/ca` for the broker's CA.
 *  The broker login is <serial> / <passphrase from the SPAN Home app>:
 *  that's exactly what `POST /api/v2/auth/register` hands back as
 *  ebusBrokerUsername/ebusBrokerPassword (verified on r202639; the docs
 *  tie a passphrase regeneration to a new broker password). Registering
 *  isn't used because the panel allows one registration per client name
 *  ("Name already exists", 422), which a restarting server can't satisfy
 *  without storing a token. Everything live arrives over MQTT as a Homie 5
 *  tree under `ebus/5/<device>/<node>/<property>`; this class mirrors
 *  that tree and normalizes it on demand.
 *
 *  Devices are classified by the `type` in their `$description`, never by
 *  parsing ids (the docs call ids opaque). Loads publish NEGATIVE active
 *  power and accumulate `exported-energy`; both are flipped to
 *  "consumption positive" here. */

const MQTTS_PORT = 8883;
const STALE_MS = 60_000;

const num = (v: string | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export class SpanClient {
  private client: MqttClient | null = null;
  /** device id → property path ("meter/active-power", "$state") → payload */
  private tree = new Map<string, Map<string, string>>();
  private types = new Map<string, string>();
  private connected = false;
  private lastMessageAt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private readonly ledger = new CircuitLedger();

  constructor(private readonly opts: { host: string; passphrase: string; clientName: string }) {}

  start(): void {
    void this.connect();
  }

  private scheduleRetry(ms: number): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, ms);
  }

  private async connect(): Promise<void> {
    let serial: string;
    let ca: string;
    try {
      const base = `http://${this.opts.host}`;
      const st = await undiciFetch(`${base}/api/v2/status`, { signal: AbortSignal.timeout(10_000) });
      if (!st.ok) throw new Error(`status: HTTP ${st.status}`);
      const s = (await st.json()) as { serialNumber?: string };
      if (!s.serialNumber) throw new Error('status: no serial number yet');
      serial = s.serialNumber.toLowerCase();
      const caRes = await undiciFetch(`${base}/api/v2/certificate/ca`, { signal: AbortSignal.timeout(10_000) });
      if (!caRes.ok) throw new Error(`ca: HTTP ${caRes.status}`);
      ca = await caRes.text();
    } catch (e) {
      console.error('[span] setup failed:', e instanceof Error ? e.message : e);
      this.scheduleRetry(60_000);
      return;
    }

    this.client?.end(true);
    const client = mqtt.connect(`mqtts://${this.opts.host}:${MQTTS_PORT}`, {
      username: serial,
      password: this.opts.passphrase,
      ca,
      // The broker cert names the panel's .local host; we connect by IP.
      servername: `span-${serial}.local`,
      clientId: `${this.opts.clientName}-${process.pid}`,
      reconnectPeriod: 5_000,
      connectTimeout: 10_000,
    });
    this.client = client;
    client.on('connect', () => {
      this.connected = true;
      console.log(`[span] connected to ${this.opts.host}`);
      client.subscribe('ebus/5/#');
    });
    client.on('close', () => {
      this.connected = false;
    });
    client.on('error', (e) => {
      console.error('[span] mqtt error:', e.message);
      // Bad credentials (the passphrase was regenerated in the app): stop
      // hammering the broker every 5 seconds and retry once a minute.
      if (/not authori[sz]ed|bad user name|password/i.test(e.message)) {
        client.end(true);
        this.connected = false;
        this.scheduleRetry(60_000);
      }
    });
    client.on('message', (topic, payload) => this.onMessage(topic, payload.toString()));
  }

  private onMessage(topic: string, value: string): void {
    // ebus/5/<device>/<node>/<property>  or  ebus/5/<device>/$state
    const parts = topic.split('/');
    if (parts.length < 4) return;
    const dev = parts[2]!;
    const prop = parts.slice(3).join('/');
    let props = this.tree.get(dev);
    if (!props) this.tree.set(dev, (props = new Map()));
    props.set(prop, value);
    if (prop === '$description') {
      try {
        const t = (JSON.parse(value) as { type?: string }).type;
        if (t) this.types.set(dev, t);
      } catch {
        // malformed description: leave the device unclassified
      }
    }
    this.lastMessageAt = Date.now();
  }

  private devicesOfType(suffix: string): Array<[string, Map<string, string>]> {
    const out: Array<[string, Map<string, string>]> = [];
    for (const [id, t] of this.types) {
      if (t.endsWith(`.${suffix}`)) {
        const p = this.tree.get(id);
        if (p) out.push([id, p]);
      }
    }
    return out;
  }

  /** Normalized snapshot, or null before the first full tree arrives. */
  info(now = Date.now()): SpanInfo | null {
    const panel = this.devicesOfType('distribution-enclosure')[0]?.[1];
    if (!panel) return null;
    const up = this.devicesOfType('lugs').find(([, p]) => p.get('info/direction') === 'UPSTREAM')?.[1];
    const bess = this.devicesOfType('bess')[0]?.[1];
    const state = panel.get('$state');

    const circuits: SpanCircuit[] = this.devicesOfType('circuit').map(([id, p]) => {
      const imported = num(p.get('meter/imported-energy')) ?? 0;
      const exported = num(p.get('meter/exported-energy')) ?? 0;
      const relay = p.get('switch/relay');
      return {
        id,
        name: p.get('info/name')?.trim() || `Circuit ${p.get('info/spaces') ?? id}`,
        spaces: p.get('info/spaces') ?? '',
        powerW: Math.round(-(num(p.get('meter/active-power')) ?? 0)),
        ratingA: num(p.get('breaker/rating')),
        relay: relay === 'OPEN' || relay === 'CLOSED' ? relay : 'UNKNOWN',
        // Mostly backfeeding over its life: a battery/inverter breaker.
        // The small floor keeps a load's metering noise from qualifying.
        source: imported > 5_000 && imported > 0.1 * exported,
        todayWh: this.ledger.add(id, exported, now),
      };
    });
    circuits.sort((a, b) => b.powerW - a.powerW);
    this.ledger.saveIfDue(now);

    return {
      reachable: this.connected && now - this.lastMessageAt < STALE_MS && (state == null || state === 'ready'),
      model: panel.get('info/model') ?? null,
      firmware: panel.get('info/firmware-version') ?? null,
      gridW: up ? Math.round(num(up.get('meter/active-power')) ?? 0) : null,
      voltageA: num(panel.get('meter/voltage-a')),
      voltageB: num(panel.get('meter/voltage-b')),
      currentA: num(up?.get('meter/current-a')),
      currentB: num(up?.get('meter/current-b')),
      serviceRatingA: num(up?.get('connection/service-rating')),
      frequencyHz: num(panel.get('meter/frequency')),
      doorClosed: panel.has('door/state') ? panel.get('door/state') === 'CLOSED' : null,
      circuits,
      backup: this.backup(panel, bess),
      updatedAt: this.lastMessageAt,
    };
  }

  private backup(panel: Map<string, string>, bess: Map<string, string> | undefined): SpanBackup | null {
    if (!panel.has('shed-forecast/total-time-remaining') && !bess) return null;
    const conf = panel.get('shed-forecast/confidence');
    let sheddable = 0;
    for (const [, p] of this.devicesOfType('circuit')) {
      const pr = p.get('load-shed/priority');
      if (pr === 'OFF_GRID' || pr === 'SOC_THRESHOLD') sheddable++;
    }
    return {
      totalMin: num(panel.get('shed-forecast/total-time-remaining')),
      nextShedMin: num(panel.get('shed-forecast/time-to-priority-shed')),
      fullChargeTotalMin: num(panel.get('shed-forecast/full-charge-total-time-remaining')),
      fullChargeNextShedMin: num(panel.get('shed-forecast/full-charge-time-to-priority-shed')),
      confidence: conf === 'LOW' || conf === 'MEDIUM' || conf === 'HIGH' ? conf : null,
      storedKWh: num(bess?.get('soc/soe')),
      capacityKWh: num(bess?.get('info/nameplate-capacity')),
      sheddableCircuits: sheddable,
    };
  }
}

// --- per-circuit daily energy -------------------------------------------------

const SPAN_PATH = join(process.cwd(), 'data', 'span.json');
const DAYS_KEPT = 14;
/** A circuit can't plausibly use this much between two ticks; anything
 *  larger is a counter reset or a replaced panel — rebase. */
const MAX_DELTA_WH = 20_000;

type CircuitLedgerFile = { last: Record<string, number>; days: Record<string, Record<string, number>> };

function dayLabel(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Books each circuit's lifetime consumption counter into local-day
 *  buckets, persisted to data/span.json so a restart keeps today's totals. */
class CircuitLedger {
  private state: CircuitLedgerFile;
  private dirty = false;
  private savedAt = 0;

  constructor() {
    try {
      const parsed = JSON.parse(readFileSync(SPAN_PATH, 'utf8')) as Partial<CircuitLedgerFile>;
      this.state = { last: parsed.last ?? {}, days: parsed.days ?? {} };
    } catch {
      this.state = { last: {}, days: {} };
    }
  }

  /** Book `counterWh` for circuit `id`; returns today's total so far. */
  add(id: string, counterWh: number, now: number): number | null {
    const date = dayLabel(now);
    const last = this.state.last[id];
    const day = (this.state.days[date] ??= {});
    if (last != null) {
      const d = counterWh - last;
      if (d > 0 && d <= MAX_DELTA_WH) {
        day[id] = (day[id] ?? 0) + d;
        this.dirty = true;
      }
    }
    if (last !== counterWh) {
      this.state.last[id] = counterWh;
      this.dirty = true;
    }
    return last == null ? null : Math.round(day[id] ?? 0);
  }

  saveIfDue(now: number, everyMs = 60_000): void {
    if (!this.dirty || now - this.savedAt < everyMs) return;
    const dates = Object.keys(this.state.days).sort();
    for (const stale of dates.slice(0, Math.max(0, dates.length - DAYS_KEPT))) delete this.state.days[stale];
    try {
      mkdirSync(dirname(SPAN_PATH), { recursive: true });
      writeFileSync(SPAN_PATH, JSON.stringify(this.state));
      this.savedAt = now;
      this.dirty = false;
    } catch (err) {
      console.error('[span] failed to persist circuit ledger:', err);
    }
  }
}
