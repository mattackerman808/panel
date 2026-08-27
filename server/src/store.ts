import { config } from './config.js';
import type {
  ClientStat,
  DpiCategory,
  HealthSubsystem,
  NetworkDevice,
  Snapshot,
  Tick,
  UdmInfo,
  UpsInfo,
  Wan,
  WanSample,
} from './types.js';

type Listener = (tick: Tick) => void;

const startTs = Date.now();

const state = {
  source: 'mock' as 'live' | 'mock',
  wans: [] as Wan[],
  histories: {} as Record<string, WanSample[]>,
  clients: [] as ClientStat[],
  dpi: [] as DpiCategory[],
  dpiCategories: [] as DpiCategory[],
  udm: null as UdmInfo | null,
  devices: [] as NetworkDevice[],
  health: [] as HealthSubsystem[],
  ups: null as UpsInfo | null,
  features: { dpiAvailable: false, perClientRates: false, snmpAvailable: false, upsAvailable: false },
};

const listeners = new Set<Listener>();

export const store = {
  setSource(source: 'live' | 'mock'): void {
    state.source = source;
  },

  setFeatures(features: Partial<typeof state.features>): void {
    state.features = { ...state.features, ...features };
  },

  pushTick(input: {
    wans: Wan[];
    clients?: ClientStat[];
    dpi?: DpiCategory[];
    dpiCategories?: DpiCategory[];
    udm?: UdmInfo;
    devices?: NetworkDevice[];
    health?: HealthSubsystem[];
    ups?: UpsInfo;
  }): void {
    const ts = Date.now();
    state.wans = input.wans;
    if (input.clients) state.clients = input.clients;
    if (input.dpi) state.dpi = input.dpi;
    if (input.dpiCategories) state.dpiCategories = input.dpiCategories;
    if (input.udm) state.udm = input.udm;
    if (input.devices) state.devices = input.devices;
    if (input.health) state.health = input.health;
    if (input.ups) state.ups = input.ups;

    const samples: Tick['samples'] = [];
    for (const w of input.wans) {
      const sample: WanSample = { ts, rxBps: w.rxBps, txBps: w.txBps, latencyMs: w.latencyMs };
      const hist = state.histories[w.id] ?? [];
      hist.push(sample);
      if (hist.length > config.history.maxSamples) {
        hist.splice(0, hist.length - config.history.maxSamples);
      }
      state.histories[w.id] = hist;
      samples.push({ id: w.id, rxBps: w.rxBps, txBps: w.txBps, latencyMs: w.latencyMs });
    }

    const tick: Tick = {
      ts,
      wans: input.wans,
      samples,
      ...(input.clients ? { clients: input.clients } : {}),
      ...(input.dpi ? { dpi: input.dpi } : {}),
      ...(input.dpiCategories ? { dpiCategories: input.dpiCategories } : {}),
      ...(input.udm ? { udm: input.udm } : {}),
      ...(input.devices ? { devices: input.devices } : {}),
      ...(input.health ? { health: input.health } : {}),
      ...(input.ups ? { ups: input.ups } : {}),
    };

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
      wans: state.wans,
      histories: Object.fromEntries(Object.entries(state.histories).map(([k, v]) => [k, v.slice()])),
      clients: state.clients,
      dpi: state.dpi,
      dpiCategories: state.dpiCategories,
      udm: state.udm,
      devices: state.devices,
      health: state.health,
      ups: state.ups,
      features: { ...state.features },
    };
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
