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
  WsMessage,
} from './types.js';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

const MAX_HISTORY = 240;

class PanelStore {
  connection = $state<ConnectionState>('connecting');
  source = $state<'live' | 'mock'>('mock');
  serverUptimeSec = $state(0);
  wans = $state<Wan[]>([]);
  histories = $state<Record<string, WanSample[]>>({});
  clients = $state<ClientStat[]>([]);
  dpi = $state<DpiCategory[]>([]);
  dpiCategories = $state<DpiCategory[]>([]);
  udm = $state<UdmInfo | null>(null);
  devices = $state<NetworkDevice[]>([]);
  health = $state<HealthSubsystem[]>([]);
  ups = $state<UpsInfo | null>(null);
  features = $state({ dpiAvailable: false, perClientRates: false, snmpAvailable: false, upsAvailable: false });
  lastTickAt = $state(0);

  applySnapshot(s: Snapshot): void {
    this.source = s.source;
    this.serverUptimeSec = s.serverUptimeSec;
    this.wans = s.wans;
    const trimmed: Record<string, WanSample[]> = {};
    for (const [k, v] of Object.entries(s.histories)) trimmed[k] = v.slice(-MAX_HISTORY);
    this.histories = trimmed;
    this.clients = s.clients;
    this.dpi = s.dpi;
    this.dpiCategories = s.dpiCategories;
    this.udm = s.udm;
    this.devices = s.devices;
    this.health = s.health;
    this.ups = s.ups;
    this.features = s.features;
    this.lastTickAt = s.ts;
  }

  applyTick(t: Tick): void {
    this.wans = t.wans;
    if (t.clients) this.clients = t.clients;
    if (t.dpi) this.dpi = t.dpi;
    if (t.dpiCategories) this.dpiCategories = t.dpiCategories;
    if (t.udm) this.udm = t.udm;
    if (t.devices) this.devices = t.devices;
    if (t.health) this.health = t.health;
    if (t.ups) this.ups = t.ups;
    const next = { ...this.histories };
    for (const s of t.samples) {
      const cur = next[s.id] ?? [];
      const updated = [...cur, { ts: t.ts, rxBps: s.rxBps, txBps: s.txBps, latencyMs: s.latencyMs }];
      next[s.id] = updated.length > MAX_HISTORY ? updated.slice(-MAX_HISTORY) : updated;
    }
    this.histories = next;
    this.lastTickAt = t.ts;
  }

  /** Aggregate current WAN throughput across all interfaces. */
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
