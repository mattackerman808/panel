import { config } from './config.js';
import { EventLog } from './events.js';
import type {
  ClientStat,
  DailyUsage,
  DeviceSample,
  DpiCategory,
  EventSeverity,
  Features,
  GatewaySample,
  HealthSubsystem,
  NetworkDevice,
  PanelEvent,
  Snapshot,
  Tick,
  UdmInfo,
  UpsInfo,
  UpsSample,
  Wan,
  WanSample,
} from './types.js';

type Listener = (tick: Tick) => void;

const startTs = Date.now();
/** Identifies this server process; see Snapshot.buildId. */
const buildId = process.env.PANEL_BUILD_ID ?? startTs.toString(36);

/** UPS polls every 5s; keep the history at the device cadence instead so an
 *  hour fits in the ring buffer. */
const UPS_SAMPLE_MIN_GAP_MS = 15_000;

const state = {
  source: 'mock' as 'live' | 'mock',
  wans: [] as Wan[],
  histories: {} as Record<string, WanSample[]>,
  usageDaily: {} as Record<string, DailyUsage[]>,
  clients: [] as ClientStat[],
  dpi: [] as DpiCategory[],
  dpiCategories: [] as DpiCategory[],
  udm: null as UdmInfo | null,
  devices: [] as NetworkDevice[],
  deviceHistories: {} as Record<string, DeviceSample[]>,
  gatewayHistory: [] as GatewaySample[],
  health: [] as HealthSubsystem[],
  ups: null as UpsInfo | null,
  upsHistory: [] as UpsSample[],
  features: {
    dpiAvailable: false,
    perClientRates: false,
    snmpAvailable: false,
    upsAvailable: false,
    controllerAvailable: false,
  } as Features,
  featuresDirty: false,
};

const listeners = new Set<Listener>();
const events = new EventLog();
/** Events raised between ticks (e.g. by the poller's recovery loop); flushed
 *  into the next tick so clients see them without a reconnect. */
let pendingEvents: PanelEvent[] = [];

function trim<T>(arr: T[], max: number): void {
  if (arr.length > max) arr.splice(0, arr.length - max);
}

function deviceSeverity(d: NetworkDevice): EventSeverity {
  return d.type === 'usw' || d.type === 'udm' ? 'crit' : 'warn';
}

/** Compare the previous and next device lists and raise events for state
 *  transitions. UniFi `state` is 1 when connected; anything else (0 offline,
 *  4 upgrading, 5 provisioning, 6 heartbeat missed, …) reads as "not up". */
function diffDevices(prev: NetworkDevice[], next: NetworkDevice[], ts: number): void {
  if (prev.length === 0) return; // first fill: nothing to compare against
  const prevById = new Map(prev.map((d) => [d.id, d]));
  for (const d of next) {
    const p = prevById.get(d.id);
    if (!p) {
      events.push({ ts, severity: 'info', kind: 'device.new', subject: d.name, message: `${d.name} (${d.modelName}) appeared` });
      continue;
    }
    const wasUp = p.state === 1;
    const isUp = d.state === 1;
    if (wasUp && !isUp) {
      events.push({ ts, severity: deviceSeverity(d), kind: 'device.offline', subject: d.name, message: `${d.name} lost contact` });
    } else if (!wasUp && isUp) {
      events.push({ ts, severity: 'info', kind: 'device.online', subject: d.name, message: `${d.name} is back online` });
    }
    if (p.firmware && d.firmware && p.firmware !== d.firmware) {
      events.push({ ts, severity: 'info', kind: 'device.firmware', subject: d.name, message: `${d.name} updated to ${d.firmware}` });
    }
  }
}

function diffWans(prev: Wan[], next: Wan[], ts: number): void {
  if (prev.length === 0) return;
  const prevById = new Map(prev.map((w) => [w.id, w]));
  for (const w of next) {
    const p = prevById.get(w.id);
    if (!p || p.status === w.status || w.status === 'unknown' || p.status === 'unknown') continue;
    if (w.status === 'down') {
      events.push({ ts, severity: 'crit', kind: 'wan.down', subject: w.label, message: `${w.label} is down` });
    } else {
      events.push({ ts, severity: 'info', kind: 'wan.up', subject: w.label, message: `${w.label} is back up` });
    }
    if (p.wanIp && w.wanIp && p.wanIp !== w.wanIp) {
      events.push({ ts, severity: 'info', kind: 'wan.ip', subject: w.label, message: `${w.label} public IP changed to ${w.wanIp}` });
    }
  }
}

function diffUps(prev: UpsInfo | null, next: UpsInfo, ts: number): void {
  if (!prev) return;
  if (prev.reachable && !next.reachable) {
    events.push({ ts, severity: 'warn', kind: 'ups.unreachable', subject: 'UPS', message: 'UPS stopped answering SNMP' });
    return;
  }
  if (!prev.reachable && next.reachable) {
    events.push({ ts, severity: 'info', kind: 'ups.reachable', subject: 'UPS', message: 'UPS is reachable again' });
  }
  if (!prev.onBattery && next.onBattery) {
    events.push({ ts, severity: 'crit', kind: 'ups.battery', subject: 'UPS', message: 'UPS transferred to battery — mains power lost' });
  } else if (prev.onBattery && !next.onBattery) {
    events.push({ ts, severity: 'info', kind: 'ups.mains', subject: 'UPS', message: 'UPS back on mains power' });
  }
  if (prev.batteryStatus === 'normal' && (next.batteryStatus === 'low' || next.batteryStatus === 'depleted')) {
    events.push({ ts, severity: 'crit', kind: 'ups.battery-low', subject: 'UPS', message: `UPS battery ${next.batteryStatus}` });
  }
}

export const store = {
  setSource(source: 'live' | 'mock'): void {
    state.source = source;
  },

  setFeatures(features: Partial<Features>): void {
    const next = { ...state.features, ...features };
    const changed = (Object.keys(next) as Array<keyof Features>).some((k) => next[k] !== state.features[k]);
    if (!changed) return;
    state.features = next;
    state.featuresDirty = true;
  },

  features(): Features {
    return { ...state.features };
  },

  /** Record an event outside the tick pipeline (poller recovery, startup).
   *  It's appended to the log immediately and shipped with the next tick. */
  recordEvent(input: { severity: EventSeverity; kind: string; subject: string; message: string; ts?: number }): PanelEvent {
    const ev = events.push(input);
    pendingEvents.push(ev);
    return ev;
  },

  pushTick(
    input: {
      wans: Wan[];
      usageDaily?: Record<string, DailyUsage[]>;
      clients?: ClientStat[];
      dpi?: DpiCategory[];
      dpiCategories?: DpiCategory[];
      udm?: UdmInfo;
      devices?: NetworkDevice[];
      health?: HealthSubsystem[];
      ups?: UpsInfo;
    },
    ts: number = Date.now(),
  ): void {
    const before = events.recent(1)[0]?.id;

    // --- state changes → events (before replacing state) ---
    diffWans(state.wans, input.wans, ts);
    if (input.devices) diffDevices(state.devices, input.devices, ts);
    if (input.ups) diffUps(state.ups, input.ups, ts);

    state.wans = input.wans;
    if (input.usageDaily) state.usageDaily = input.usageDaily;
    if (input.clients) state.clients = input.clients;
    if (input.dpi) state.dpi = input.dpi;
    if (input.dpiCategories) state.dpiCategories = input.dpiCategories;
    if (input.udm) state.udm = input.udm;
    if (input.devices) state.devices = input.devices;
    if (input.health) state.health = input.health;
    if (input.ups) state.ups = input.ups;

    // --- WAN history ---
    const samples: Tick['samples'] = [];
    for (const w of input.wans) {
      const sample: WanSample = { ts, rxBps: w.rxBps, txBps: w.txBps, latencyMs: w.latencyMs };
      const hist = state.histories[w.id] ?? [];
      hist.push(sample);
      trim(hist, config.history.maxSamples);
      state.histories[w.id] = hist;
      samples.push({ id: w.id, rxBps: w.rxBps, txBps: w.txBps, latencyMs: w.latencyMs });
    }

    // --- device history ---
    let deviceSamples: Tick['deviceSamples'];
    if (input.devices) {
      deviceSamples = [];
      const seen = new Set<string>();
      for (const d of input.devices) {
        if (!d.id) continue;
        seen.add(d.id);
        const s: DeviceSample = { ts, bytesPerSec: d.bytesRate, clients: d.numClients };
        const hist = state.deviceHistories[d.id] ?? [];
        hist.push(s);
        trim(hist, config.history.deviceSamples);
        state.deviceHistories[d.id] = hist;
        deviceSamples.push({ id: d.id, ...s });
      }
      // Drop history for devices that left the controller entirely.
      for (const id of Object.keys(state.deviceHistories)) if (!seen.has(id)) delete state.deviceHistories[id];
    }

    // --- gateway history ---
    let gatewaySample: GatewaySample | undefined;
    if (input.udm) {
      const wired = state.clients.filter((c) => c.isWired).length;
      gatewaySample = {
        ts,
        cpuPct: input.udm.cpuPct,
        memPct: input.udm.memPct,
        tempC: input.udm.tempC,
        clients: state.clients.length,
        wired,
        wireless: state.clients.length - wired,
      };
      state.gatewayHistory.push(gatewaySample);
      trim(state.gatewayHistory, config.history.deviceSamples);
    }

    // --- UPS history (subsampled) ---
    let upsSample: UpsSample | undefined;
    if (input.ups && input.ups.reachable) {
      const last = state.upsHistory[state.upsHistory.length - 1];
      if (!last || ts - last.ts >= UPS_SAMPLE_MIN_GAP_MS) {
        upsSample = {
          ts,
          loadPct: input.ups.loadPct,
          outputPowerW: input.ups.outputPowerW,
          inputVoltage: input.ups.inputVoltage,
          chargePct: input.ups.chargePct,
        };
        state.upsHistory.push(upsSample);
        trim(state.upsHistory, config.history.deviceSamples);
      }
    }

    // --- events raised this tick ---
    const recent = events.recent(50);
    const newEvents: PanelEvent[] = [];
    for (const ev of recent) {
      if (ev.id === before) break;
      newEvents.push(ev);
    }
    // recent() is newest-first; ship oldest-first and include anything the
    // poller recorded between ticks (deduped by id).
    const ids = new Set(newEvents.map((e) => e.id));
    const shipped = [...pendingEvents.filter((e) => !ids.has(e.id)), ...newEvents.reverse()].sort((a, b) => a.ts - b.ts);
    pendingEvents = [];

    const tick: Tick = {
      ts,
      wans: input.wans,
      samples,
      ...(input.usageDaily ? { usageDaily: input.usageDaily } : {}),
      ...(input.clients ? { clients: input.clients } : {}),
      ...(input.dpi ? { dpi: input.dpi } : {}),
      ...(input.dpiCategories ? { dpiCategories: input.dpiCategories } : {}),
      ...(input.udm ? { udm: input.udm } : {}),
      ...(input.devices ? { devices: input.devices } : {}),
      ...(deviceSamples ? { deviceSamples } : {}),
      ...(gatewaySample ? { gatewaySample } : {}),
      ...(input.health ? { health: input.health } : {}),
      ...(input.ups ? { ups: input.ups } : {}),
      ...(upsSample ? { upsSample } : {}),
      ...(shipped.length > 0 ? { events: shipped } : {}),
      ...(state.featuresDirty ? { features: { ...state.features } } : {}),
    };
    state.featuresDirty = false;

    for (const l of listeners) {
      try {
        l(tick);
      } catch (err) {
        console.error('[store] listener error', err);
      }
    }
  },

  snapshot(): Snapshot {
    return {
      ts: Date.now(),
      source: state.source,
      serverUptimeSec: Math.floor((Date.now() - startTs) / 1000),
      buildId,
      ui: { siteName: config.ui.siteName, pages: config.ui.pages, dwellMs: config.ui.dwellMs },
      wans: state.wans,
      histories: Object.fromEntries(Object.entries(state.histories).map(([k, v]) => [k, v.slice()])),
      usageDaily: state.usageDaily,
      clients: state.clients,
      dpi: state.dpi,
      dpiCategories: state.dpiCategories,
      udm: state.udm,
      devices: state.devices,
      deviceHistories: Object.fromEntries(Object.entries(state.deviceHistories).map(([k, v]) => [k, v.slice()])),
      gatewayHistory: state.gatewayHistory.slice(),
      health: state.health,
      ups: state.ups,
      upsHistory: state.upsHistory.slice(),
      events: events.recent(50),
      features: { ...state.features },
    };
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
