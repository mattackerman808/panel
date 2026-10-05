import type {
  ClientStat,
  DailyUsage,
  DeviceSample,
  DpiCategory,
  Features,
  GatewaySample,
  HealthSubsystem,
  NetworkDevice,
  PanelEvent,
  Snapshot,
  Tick,
  UdmInfo,
  UiConfig,
  UpsInfo,
  UpsSample,
  Wan,
  WanSample,
  WsMessage,
} from './types.js';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

const MAX_WAN_HISTORY = 600;
const MAX_DEVICE_HISTORY = 300;
const MAX_EVENTS = 60;

const DEFAULT_FEATURES: Features = {
  dpiAvailable: false,
  perClientRates: false,
  snmpAvailable: false,
  upsAvailable: false,
  controllerAvailable: false,
};

const DEFAULT_UI: UiConfig = { siteName: 'Network', pages: null, dwellMs: 24_000 };

function tail<T>(arr: T[], max: number): T[] {
  return arr.length > max ? arr.slice(-max) : arr;
}

/** Client-side mirror of the server snapshot. Every field the server added
 *  after the first release is defaulted here, so an older server still
 *  drives this UI (with the corresponding panels empty). */
class PanelStore {
  connection = $state<ConnectionState>('connecting');
  source = $state<'live' | 'mock'>('mock');
  serverUptimeSec = $state(0);
  ui = $state<UiConfig>(DEFAULT_UI);
  wans = $state<Wan[]>([]);
  histories = $state<Record<string, WanSample[]>>({});
  usageDaily = $state<Record<string, DailyUsage[]>>({});
  clients = $state<ClientStat[]>([]);
  dpi = $state<DpiCategory[]>([]);
  dpiCategories = $state<DpiCategory[]>([]);
  udm = $state<UdmInfo | null>(null);
  devices = $state<NetworkDevice[]>([]);
  deviceHistories = $state<Record<string, DeviceSample[]>>({});
  gatewayHistory = $state<GatewaySample[]>([]);
  health = $state<HealthSubsystem[]>([]);
  ups = $state<UpsInfo | null>(null);
  upsHistory = $state<UpsSample[]>([]);
  /** Newest first. */
  events = $state<PanelEvent[]>([]);
  features = $state<Features>(DEFAULT_FEATURES);
  lastTickAt = $state(0);
  /** Server process id from the first snapshot; a different one later means
   *  the server was restarted (most likely upgraded) and the page reloads
   *  so the kiosk picks up the new bundle. */
  private buildId: string | null = null;

  applySnapshot(s: Snapshot): void {
    if (s.buildId) {
      if (this.buildId && this.buildId !== s.buildId && typeof location !== 'undefined') {
        // Stagger slightly so several kiosks don't hammer the server at once.
        setTimeout(() => location.reload(), 500 + Math.random() * 2500);
        return;
      }
      this.buildId = s.buildId;
    }
    this.source = s.source;
    this.serverUptimeSec = s.serverUptimeSec;
    this.ui = { ...DEFAULT_UI, ...(s.ui ?? {}) };
    this.wans = s.wans ?? [];
    const trimmed: Record<string, WanSample[]> = {};
    for (const [k, v] of Object.entries(s.histories ?? {})) trimmed[k] = tail(v, MAX_WAN_HISTORY);
    this.histories = trimmed;
    this.usageDaily = s.usageDaily ?? {};
    this.clients = s.clients ?? [];
    this.dpi = s.dpi ?? [];
    this.dpiCategories = s.dpiCategories ?? [];
    this.udm = s.udm ?? null;
    this.devices = s.devices ?? [];
    this.deviceHistories = s.deviceHistories ?? {};
    this.gatewayHistory = s.gatewayHistory ?? [];
    this.health = s.health ?? [];
    this.ups = s.ups ?? null;
    this.upsHistory = s.upsHistory ?? [];
    this.events = (s.events ?? []).slice(0, MAX_EVENTS);
    this.features = { ...DEFAULT_FEATURES, ...(s.features ?? {}) };
    this.lastTickAt = s.ts;
  }

  applyTick(t: Tick): void {
    this.wans = t.wans;
    if (t.usageDaily) this.usageDaily = t.usageDaily;
    if (t.clients) this.clients = t.clients;
    if (t.dpi) this.dpi = t.dpi;
    if (t.dpiCategories) this.dpiCategories = t.dpiCategories;
    if (t.udm) this.udm = t.udm;
    if (t.devices) this.devices = t.devices;
    if (t.health) this.health = t.health;
    if (t.ups) this.ups = t.ups;
    if (t.features) this.features = { ...DEFAULT_FEATURES, ...t.features };

    const next = { ...this.histories };
    for (const s of t.samples) {
      const cur = next[s.id] ?? [];
      next[s.id] = tail([...cur, { ts: t.ts, rxBps: s.rxBps, txBps: s.txBps, latencyMs: s.latencyMs }], MAX_WAN_HISTORY);
    }
    this.histories = next;

    if (t.deviceSamples) {
      const dh = { ...this.deviceHistories };
      for (const s of t.deviceSamples) {
        const { id, ...sample } = s;
        dh[id] = tail([...(dh[id] ?? []), sample], MAX_DEVICE_HISTORY);
      }
      this.deviceHistories = dh;
    }
    if (t.gatewaySample) this.gatewayHistory = tail([...this.gatewayHistory, t.gatewaySample], MAX_DEVICE_HISTORY);
    if (t.upsSample) this.upsHistory = tail([...this.upsHistory, t.upsSample], MAX_DEVICE_HISTORY);
    if (t.events && t.events.length > 0) {
      const known = new Set(this.events.map((e) => e.id));
      const fresh = t.events.filter((e) => !known.has(e.id)).sort((a, b) => b.ts - a.ts);
      this.events = [...fresh, ...this.events].slice(0, MAX_EVENTS);
    }
    this.lastTickAt = t.ts;
  }

  /** Aggregate current WAN throughput across all interfaces (bytes/s). */
  totalRxBps(): number {
    return this.wans.reduce((a, w) => a + w.rxBps, 0);
  }
  totalTxBps(): number {
    return this.wans.reduce((a, w) => a + w.txBps, 0);
  }
}

export const panel = new PanelStore();

export function connectWs(): () => void {
  let ws: WebSocket | null = null;
  let reconnectDelay = 1000;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function open() {
    if (closed) return;
    panel.connection = 'connecting';
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.addEventListener('open', () => {
      panel.connection = 'open';
      reconnectDelay = 1000;
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WsMessage;
        if (msg.type === 'snapshot') panel.applySnapshot(msg.data);
        else if (msg.type === 'tick') panel.applyTick(msg.data);
      } catch (err) {
        console.error('[ws] parse error', err);
      }
    });
    ws.addEventListener('close', () => {
      panel.connection = 'closed';
      if (closed) return;
      reconnectTimer = setTimeout(open, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.6, 10_000);
    });
    ws.addEventListener('error', () => {
      panel.connection = 'error';
    });
  }

  open();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}
