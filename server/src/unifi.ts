import { Agent, fetch as undiciFetch } from 'undici';
import { modelName } from './catalog.js';
import type {
  Band,
  ClientStat,
  DpiCategory,
  HealthSubsystem,
  NetworkDevice,
  NetworkPort,
  NetworkRadio,
  PortNeighbor,
  UdmInfo,
} from './types.js';

type Mode = 'legacy' | 'integration' | 'none';

// ---------------------------------------------------------------------------
// Raw payload shapes. Only the fields we read are declared. The v2 and legacy
// endpoints overlap heavily (same key names), so one shape serves both and
// the mappers read "whichever endpoint supplied it".
// ---------------------------------------------------------------------------

type RawHealthMonitor = {
  target?: string;
  type?: string;
  latency_average?: number;
  availability?: number;
};

type RawHealthUptimeBucket = {
  latency_average?: number;
  availability?: number;
  monitors?: RawHealthMonitor[];
  alerting_monitors?: RawHealthMonitor[];
};

type RawHealthSubsystem = {
  subsystem?: string;
  status?: string;
  latency?: number;
  drops?: number;
  uptime?: number;
  // www-only
  xput_up?: number;
  xput_down?: number;
  speedtest_lastrun?: number;
  speedtest_status?: string;
  // wan-only
  wan_ip?: string;
  isp_name?: string;
  isp_organization?: string;
  asn?: number;
  uptime_stats?: Record<string, RawHealthUptimeBucket>;
  // lan/wlan
  num_user?: number;
  num_guest?: number;
};

type RawFingerprint = {
  computed_dev_id?: number;
  dev_id?: number;
  dev_id_override?: number;
  has_override?: boolean;
};

type RawClient = {
  _id?: string;
  id?: string;
  user_id?: string;
  mac?: string;
  ip?: string;
  hostname?: string;
  name?: string;
  display_name?: string;
  oui?: string;
  is_wired?: boolean;
  is_guest?: boolean;
  /** Some v2 responses carry `WIRED` / `WIRELESS` here instead of is_wired. */
  type?: string;
  signal?: number;
  rssi?: number;
  rx_bytes?: number;
  tx_bytes?: number;
  'rx_bytes-r'?: number;
  'tx_bytes-r'?: number;
  first_seen?: number;
  last_seen?: number;
  uptime?: number;
  fingerprint?: RawFingerprint;
  dev_id?: number;
  dev_id_override?: number;
  // association (legacy /stat/sta and, on newer firmware, v2 too)
  ap_mac?: string;
  sw_mac?: string;
  sw_port?: number;
  uplink_mac?: string;
  uplink_remote_port?: number | string;
  radio?: string;
  radio_proto?: string;
  channel?: number;
  essid?: string;
  network?: string;
  network_name?: string;
  satisfaction?: number;
  /** PHY rates in Kbps. */
  rx_rate?: number;
  tx_rate?: number;
  wired_rate_mbps?: number;
};

type RawTrafficApp = {
  application?: number;
  category?: number;
  bytes_received?: number;
  bytes_transmitted?: number;
  total_bytes?: number;
  client_count?: number;
};

type RawTrafficResponse = {
  total_usage_by_app?: RawTrafficApp[];
  client_usage_by_app?: RawTrafficApp[];
};

type RawGatewayWan = {
  ifname?: string;
  uplink_ifname?: string;
  name?: string;
  ip?: string;
  ipv6?: string[];
  mac?: string;
  netmask?: string;
  enable?: boolean;
  up?: boolean;
  is_uplink?: boolean;
  /** Negotiated speed / port max, in Mbps. */
  speed?: number;
  max_speed?: number;
  media?: string;
  rx_bytes?: number;
  tx_bytes?: number;
  latency?: number;
  availability?: number;
  uptime?: number;
};

type RawLldpEntry = {
  local_port_idx?: number;
  chassis_id?: string;
  port_id?: string;
  system_name?: string;
};

type RawPort = {
  port_idx?: number;
  name?: string;
  up?: boolean;
  speed?: number;
  is_uplink?: boolean;
  enable?: boolean;
  poe_enable?: boolean;
  port_poe?: boolean;
  poe_power?: string | number;
  poe_mode?: string;
  rx_bytes?: number;
  tx_bytes?: number;
  'rx_bytes-r'?: number;
  'tx_bytes-r'?: number;
  rx_errors?: number;
  tx_errors?: number;
  rx_dropped?: number;
  tx_dropped?: number;
  full_duplex?: boolean;
  media?: string;
  stp_state?: string;
  satisfaction?: number;
  // LLDP. UniFi has used both flat fields and a nested table across
  // firmware versions; we read whichever is present.
  lldp_chassis_id?: string;
  lldp_port_id?: string;
  lldp_system_name?: string;
  lldp_table?: Array<{ chassis_id?: string; port_id?: string; system_name?: string }>;
};

type RawRadioStats = {
  name?: string;
  radio?: string;
  channel?: number;
  bw?: number;
  num_sta?: number;
  'user-num_sta'?: number;
  'guest-num_sta'?: number;
  cu_total?: number;
  cu_self_rx?: number;
  cu_self_tx?: number;
  satisfaction?: number;
  tx_retries?: number;
  tx_packets?: number;
  tx_power?: number;
};

type RawRadio = {
  name?: string;
  radio?: string;
  channel?: number | string;
  ht?: number | string;
  tx_power?: number;
};

type RawVap = {
  radio?: string;
  radio_name?: string;
  essid?: string;
  num_sta?: number;
  is_guest?: boolean;
  up?: boolean;
  channel?: number;
};

/** A device entry from either `/v2/api/site/{site}/device` or the legacy
 *  `/api/s/{site}/stat/device`. The two carry different subsets (the v2
 *  endpoint omits per-port PoE wattage and LLDP on some firmwares; the
 *  legacy one has everything but older naming), so both are fetched and
 *  merged by mac. */
type RawDevice = {
  _id?: string;
  mac?: string;
  type?: string;
  model?: string;
  name?: string;
  hostname?: string;
  ip?: string;
  version?: string;
  upgradable?: boolean;
  state?: number;
  uptime?: number;
  last_seen?: number;
  num_sta?: number;
  satisfaction?: number;
  'bytes-r'?: number;
  rx_bytes?: number;
  tx_bytes?: number;
  'system-stats'?: { cpu?: string; mem?: string; uptime?: string };
  general_temperature?: number;
  temperatures?: Array<{ value?: number; name?: string; type?: string }>;
  overheating?: boolean;
  fan_level?: number;
  total_max_power?: number;
  port_table?: RawPort[];
  lldp_table?: RawLldpEntry[];
  uplink?: {
    uplink_mac?: string;
    uplink_remote_port?: number | string;
    uplink_device_name?: string;
    type?: string;
    speed?: number;
  };
  vap_table?: RawVap[];
  radio_table?: RawRadio[];
  radio_table_stats?: RawRadioStats[];
  is_gateway?: boolean;
  /** UDM gateway WAN ports — keys are `wan1` and `wan2`. */
  wan1?: RawGatewayWan;
  wan2?: RawGatewayWan;
  /** Top-level IPv6 addresses bound to the gateway (global + link-local). */
  ipv6?: string[];
};

/** Per-WAN details extracted from the gateway device entry. Keyed by the
 *  uplink interface name (`eth9`, `eth10`, …) so the poller can match it
 *  against the SNMP-derived WAN list. */
export type GatewayWanDetails = {
  ifName: string;
  ip: string | null;
  ipv6: string | null;
  mac: string | null;
  rxBytes: number;
  txBytes: number;
  latencyMs: number | null;
  availabilityPct: number | null;
  up: boolean;
  /** Negotiated port speed in Mbps, when the controller reports it. */
  speedMbps: number | null;
  uptimeSec: number | null;
};

const DPI_CATEGORIES: Record<number, string> = {
  0: 'Instant Messaging',
  1: 'P2P',
  2: 'File Transfer',
  3: 'Streaming',
  4: 'Mail',
  5: 'VoIP',
  6: 'Database',
  7: 'Games',
  8: 'Apps',
  9: 'Web',
  10: 'Network Tools',
  11: 'Crypto',
  12: 'Update Tools',
  13: 'Conferencing',
  14: 'Music',
  15: 'Social',
  16: 'Advertising',
  17: 'Adult',
  18: 'News',
  19: 'Shopping',
  20: 'Cloud',
  21: 'Business',
  22: 'Privacy',
  23: 'Remote Access',
  24: 'Game Streaming',
  255: 'Unidentified',
};

function dpiCatName(id: number): string {
  return DPI_CATEGORIES[id] ?? `Category ${id}`;
}

/** The legacy device list is consumed by three pollers (devices, gateway
 *  info, WAN details) that fire on the same cadence; cache it briefly so one
 *  cycle costs one request. */
const LEGACY_DEVICES_TTL_MS = 5_000;

export type UnifiOpts = {
  host: string;
  apiKey?: string;
  username?: string;
  password?: string;
  site: string;
  insecureTls: boolean;
};

export class UnifiClient {
  private mode: Mode = 'none';
  private cookie = '';
  private csrfToken = '';
  private agent: Agent;
  private base: string;
  /** Combined-id (cat<<16 | app) → human name. Loaded once at connect. */
  private appCatalog: Map<number, string> = new Map();
  /** Category id → human name. Loaded from same UI catalog as appCatalog;
   *  authoritative over the hardcoded fallback in DPI_CATEGORIES. */
  private categoryCatalog: Map<number, string> = new Map();
  /** Device fingerprint id → device name (e.g. 2900 → "Apple TV"). Loaded
   *  from /v2/api/fingerprint_devices/0 once at connect. */
  private deviceCatalog: Map<number, string> = new Map();
  private legacyDevicesCache: { at: number; promise: Promise<RawDevice[]> } | null = null;
  private warnedLegacyClients = false;

  constructor(private opts: UnifiOpts) {
    this.agent = new Agent({
      connect: { rejectUnauthorized: !opts.insecureTls },
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
    });
    this.base = `https://${opts.host}`;
    if (opts.username && opts.password) this.mode = 'legacy';
    else if (opts.apiKey) this.mode = 'integration';
  }

  getMode(): Mode {
    return this.mode;
  }

  async connect(): Promise<void> {
    if (this.mode === 'legacy') {
      await this.legacyLogin();
      // Best-effort: load the catalogs so /api/snapshot can label top apps
      // and use authoritative category names. Failure here doesn't block.
      try {
        const { apps, categories } = await this.fetchDpiCatalogs();
        this.appCatalog = apps;
        this.categoryCatalog = categories;
        console.log(`[unifi] DPI catalog loaded: ${apps.size} apps, ${categories.size} categories`);
      } catch (err) {
        console.error('[unifi] DPI catalog fetch failed:', err);
      }
      try {
        this.deviceCatalog = await this.fetchDeviceCatalog();
        console.log(`[unifi] device catalog loaded: ${this.deviceCatalog.size} entries`);
      } catch (err) {
        console.error('[unifi] device catalog fetch failed:', err);
      }
    } else if (this.mode === 'integration') {
      // Probe sites endpoint to verify key works.
      await this.integrationGet('/proxy/network/integration/v1/sites');
    } else {
      throw new Error('No UDM credentials configured');
    }
  }

  /** Fetch the UniFi UI's `dynamic.dpi.js` and parse its
   *  `<id>:{name:"..."}` entries. The asset path includes a hash that
   *  changes per firmware build, so we discover it from the main HTML.
   *  The file contains both category entries (small ids) and combined
   *  app entries (cat<<16 | app); we extract both. The within-category
   *  app sub-blocks reuse small ids, but those re-appear after the
   *  category block so first-occurrence-wins on small ids gives us the
   *  category names. */
  private async fetchDpiCatalogs(): Promise<{
    apps: Map<number, string>;
    categories: Map<number, string>;
  }> {
    const html = await this.legacyGetText('/manage/');
    const m = html.match(/angular\/([a-zA-Z0-9_-]+)\/js\/index\.js/);
    if (!m) throw new Error('could not find angular asset hash in /manage/');
    const js = await this.legacyGetText(`/manage/angular/${m[1]}/js/dynamic.dpi.js`);
    const apps = new Map<number, string>();
    const categories = new Map<number, string>();
    for (const entry of js.matchAll(/(\d+):\{name:"([^"]+)"/g)) {
      const id = Number(entry[1]);
      const name = entry[2]!;
      if (id >= 65536) apps.set(id, name);
      else if (id <= 255 && !categories.has(id)) categories.set(id, name);
    }
    return { apps, categories };
  }

  /** Fetch UniFi's device-fingerprint catalog. Maps numeric dev_id (the
   *  fingerprint engine's identifier for a make+model) to a human-readable
   *  name like "Apple TV" or "Ring Backyard". */
  private async fetchDeviceCatalog(): Promise<Map<number, string>> {
    const r = await this.legacyGet<{
      dev_ids?: Record<string, { name?: string }>;
    }>('/v2/api/fingerprint_devices/0');
    const map = new Map<number, string>();
    for (const [id, entry] of Object.entries(r.dev_ids ?? {})) {
      const name = entry.name?.trim();
      if (name) map.set(Number(id), name);
    }
    return map;
  }

  /** Build a ClientStat from the v2 entry, backfilling association fields
   *  (AP / switch port / radio / SSID / network) from the legacy `/stat/sta`
   *  entry for the same mac when v2 doesn't carry them. */
  private toClient(primary: RawClient, secondary: RawClient | null): ClientStat {
    const first = <K extends keyof RawClient>(k: K): RawClient[K] | undefined => primary[k] ?? secondary?.[k];
    const id = primary.id ?? primary._id ?? primary.user_id ?? primary.mac ?? secondary?._id ?? '';
    const fp = primary.fingerprint ?? secondary?.fingerprint;
    // Override beats the auto-computed id (lets users rename in UDM UI).
    const devId = fp?.has_override
      ? (fp.dev_id_override ?? fp.dev_id)
      : (fp?.computed_dev_id ?? fp?.dev_id ?? first('dev_id_override') ?? first('dev_id'));
    const device = devId ? (this.deviceCatalog.get(devId) ?? null) : null;
    const oui = first('oui');
    const vendor = oui && oui.length > 0 ? oui : null;
    const isWiredRaw = first('is_wired');
    const type = first('type');
    const isWired = typeof isWiredRaw === 'boolean' ? isWiredRaw : type === 'WIRED';
    const radio = first('radio');
    const channel = num(first('channel'));
    const band: Band | null = isWired ? null : bandFromRadio(radio, channel ?? 0);
    const uplinkMac = normalizeMac(isWired ? (first('sw_mac') ?? first('uplink_mac')) : (first('ap_mac') ?? first('uplink_mac'))) || null;
    const swPortRaw = first('sw_port') ?? first('uplink_remote_port');
    const swPort = isWired ? num(swPortRaw) : null;
    const wiredRate = num(first('wired_rate_mbps'));
    const rxRateMbps = wiredRate ?? scaleRate(num(first('rx_rate')));
    const txRateMbps = wiredRate ?? scaleRate(num(first('tx_rate')));
    return {
      id,
      name: primary.display_name ?? primary.name ?? primary.hostname ?? secondary?.name ?? secondary?.hostname ?? primary.mac ?? id,
      ip: first('ip') ?? null,
      mac: normalizeMac(first('mac')),
      rxBps: first('rx_bytes-r') ?? 0,
      txBps: first('tx_bytes-r') ?? 0,
      rxBytes: first('rx_bytes') ?? 0,
      txBytes: first('tx_bytes') ?? 0,
      isWired,
      isGuest: first('is_guest') === true,
      signal: isWired ? null : (num(first('signal')) ?? num(first('rssi')) ?? null),
      vendor,
      device,
      firstSeen: first('first_seen') ?? null,
      lastSeen: first('last_seen') ?? null,
      network: first('network_name') ?? first('network') ?? null,
      uplinkMac,
      swPort,
      band,
      channel: isWired ? null : channel,
      essid: isWired ? null : (first('essid') ?? null),
      rxRateMbps,
      txRateMbps,
      satisfaction: num(first('satisfaction')),
      uptimeSec: num(first('uptime')),
    };
  }

  private async legacyGetText(path: string): Promise<string> {
    const url = `${this.base}/proxy/network${path}`;
    const doFetch = () =>
      undiciFetch(url, {
        headers: { cookie: this.cookie, 'x-csrf-token': this.csrfToken },
        dispatcher: this.agent,
      });
    let res = await doFetch();
    if (res.status === 401 || res.status === 403) {
      await this.legacyLogin();
      res = await doFetch();
    }
    if (!res.ok) throw new Error(`UDM GET ${path} failed: ${res.status}`);
    return res.text();
  }

  private async legacyLogin(): Promise<void> {
    const res = await undiciFetch(`${this.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: this.opts.username,
        password: this.opts.password,
        remember: true,
      }),
      dispatcher: this.agent,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`UDM login failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const setCookie = res.headers.get('set-cookie') ?? '';
    const tokenMatch = setCookie.match(/TOKEN=([^;]+)/);
    if (!tokenMatch) throw new Error('UDM login: no TOKEN cookie returned');
    this.cookie = `TOKEN=${tokenMatch[1]}`;
    this.csrfToken = res.headers.get('x-csrf-token') ?? res.headers.get('x-updated-csrf-token') ?? '';
  }

  private async legacyGet<T>(path: string): Promise<T> {
    const url = `${this.base}/proxy/network${path}`;
    const doFetch = () =>
      undiciFetch(url, {
        headers: {
          cookie: this.cookie,
          'x-csrf-token': this.csrfToken,
          accept: 'application/json',
        },
        dispatcher: this.agent,
      });
    let res = await doFetch();
    if (res.status === 401 || res.status === 403) {
      await this.legacyLogin();
      res = await doFetch();
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`UDM GET ${path} failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  private async integrationGet<T>(path: string): Promise<T> {
    const res = await undiciFetch(`${this.base}${path}`, {
      headers: {
        'x-api-key': this.opts.apiKey ?? '',
        accept: 'application/json',
      },
      dispatcher: this.agent,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`UDM integration GET ${path} failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  /** Legacy `/stat/device`, shared across the per-cycle pollers. */
  private legacyDevices(): Promise<RawDevice[]> {
    const now = Date.now();
    if (this.legacyDevicesCache && now - this.legacyDevicesCache.at < LEGACY_DEVICES_TTL_MS) {
      return this.legacyDevicesCache.promise;
    }
    const promise = this.legacyGet<{ data?: RawDevice[] }>(`/api/s/${this.opts.site}/stat/device`).then(
      (r) => r.data ?? [],
    );
    this.legacyDevicesCache = { at: now, promise };
    promise.catch(() => {
      this.legacyDevicesCache = null;
    });
    return promise;
  }

  async getClients(): Promise<ClientStat[]> {
    if (this.mode === 'legacy') {
      // The v2 endpoint returns the richer identity info (UI display name,
      // vendor, fingerprint); the legacy one carries the association fields
      // (AP / switch port / radio / SSID). Fetch both and merge by mac; if
      // one fails, fall back to the other alone.
      const [v2Res, legacyRes] = await Promise.allSettled([
        this.legacyGet<RawClient[]>(
          `/v2/api/site/${this.opts.site}/clients/active?includeTrafficUsage=true&includeUnifiDevices=false`,
        ),
        this.legacyGet<{ data?: RawClient[] }>(`/api/s/${this.opts.site}/stat/sta`),
      ]);
      const v2 = v2Res.status === 'fulfilled' && Array.isArray(v2Res.value) ? v2Res.value : null;
      const legacy = legacyRes.status === 'fulfilled' ? (legacyRes.value.data ?? []) : null;
      if (legacyRes.status === 'rejected' && !this.warnedLegacyClients) {
        this.warnedLegacyClients = true;
        console.error('[unifi] legacy /stat/sta failed (client↔AP association unavailable):', legacyRes.reason);
      }
      if (!v2 && !legacy) {
        throw v2Res.status === 'rejected' ? v2Res.reason : new Error('no client data');
      }
      const legacyByMac = new Map<string, RawClient>();
      for (const c of legacy ?? []) {
        const mac = normalizeMac(c.mac);
        if (mac) legacyByMac.set(mac, c);
      }
      if (v2) return v2.map((c) => this.toClient(c, legacyByMac.get(normalizeMac(c.mac)) ?? null));
      return (legacy ?? []).map((c) => this.toClient(c, null));
    }
    if (this.mode === 'integration') {
      const sites = await this.integrationGet<{ data: Array<{ id: string }> }>(
        '/proxy/network/integration/v1/sites',
      );
      const siteId = sites.data?.[0]?.id;
      if (!siteId) return [];
      const r = await this.integrationGet<{
        data: Array<{
          id: string;
          name?: string;
          ipAddress?: string;
          macAddress?: string;
          type?: string;
          connectedAt?: string;
        }>;
      }>(`/proxy/network/integration/v1/sites/${siteId}/clients?limit=200`);
      return (r.data ?? []).map((c) => ({
        id: c.id,
        name: c.name ?? c.macAddress ?? c.id,
        ip: c.ipAddress ?? null,
        mac: normalizeMac(c.macAddress),
        rxBps: 0,
        txBps: 0,
        rxBytes: 0,
        txBytes: 0,
        isWired: c.type === 'WIRED',
        isGuest: false,
        signal: null,
        vendor: null,
        device: null,
        firstSeen: c.connectedAt ? Math.floor(new Date(c.connectedAt).getTime() / 1000) : null,
        lastSeen: null,
        network: null,
        uplinkMac: null,
        swPort: null,
        band: null,
        channel: null,
        essid: null,
        rxRateMbps: null,
        txRateMbps: null,
        satisfaction: null,
        uptimeSec: null,
      }));
    }
    return [];
  }

  async getTraffic(): Promise<{ apps: DpiCategory[]; categories: DpiCategory[] }> {
    if (this.mode !== 'legacy') return { apps: [], categories: [] };
    // UniFi Network 9.x retired /stat/dpi (still 200s but always empty).
    // The dashboard now reads from /v2/.../traffic, which expects ms-precision
    // timestamps and an explicit window. 24h matches what the UI's "1D" shows.
    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000;
    const r = await this.legacyGet<RawTrafficResponse>(
      `/v2/api/site/${this.opts.site}/traffic?start=${start}&end=${end}&includeUnidentified=true`,
    );
    const rawApps = r.total_usage_by_app ?? [];
    const bytesOf = (a: RawTrafficApp) =>
      a.total_bytes ?? (a.bytes_received ?? 0) + (a.bytes_transmitted ?? 0);
    const total = rawApps.reduce((acc, a) => acc + bytesOf(a), 0);

    const catName = (cat: number): string =>
      this.categoryCatalog.get(cat) ?? dpiCatName(cat);

    const apps = rawApps
      .map((a) => {
        const cat = a.category ?? 255;
        const app = a.application ?? 0;
        const combined = (cat << 16) | app;
        const bytes = bytesOf(a);
        const name =
          this.appCatalog.get(combined) ??
          (cat === 255 ? 'Unidentified' : `${catName(cat)} · ${app}`);
        return { id: String(combined), name, bytes, pct: total > 0 ? bytes / total : 0 };
      })
      .sort((a, b) => b.bytes - a.bytes);

    const byCat = new Map<number, number>();
    for (const a of rawApps) {
      const cat = a.category ?? 255;
      byCat.set(cat, (byCat.get(cat) ?? 0) + bytesOf(a));
    }
    const categories = [...byCat.entries()]
      .map(([cat, bytes]) => ({
        id: String(cat),
        name: catName(cat),
        bytes,
        pct: total > 0 ? bytes / total : 0,
      }))
      .sort((a, b) => b.bytes - a.bytes);

    return { apps, categories };
  }

  async getDevices(): Promise<NetworkDevice[]> {
    if (this.mode !== 'legacy') return [];
    // The v2 device endpoint doesn't include poe_power on some firmwares,
    // and on the cn10k gateway it also returns empty LLDP. Per-port wattage,
    // port error counters, the LLDP table, PoE budget and the VAP table all
    // live on the legacy /stat/device endpoint, so we fetch both and merge
    // by device mac. Either side alone is enough to render the fleet.
    const [v2Res, legacyRes] = await Promise.allSettled([
      this.legacyGet<{ network_devices?: RawDevice[] }>(
        `/v2/api/site/${this.opts.site}/device?separateUnmanaged=true&includeTrafficUsage=true`,
      ),
      this.legacyDevices(),
    ]);
    const v2 = v2Res.status === 'fulfilled' ? (v2Res.value.network_devices ?? []) : null;
    const legacy = legacyRes.status === 'fulfilled' ? legacyRes.value : null;
    if (v2Res.status === 'rejected') console.error('[unifi] v2 device fetch failed:', v2Res.reason);
    if (legacyRes.status === 'rejected') console.error('[unifi] legacy device fetch failed:', legacyRes.reason);
    if (!v2 && !legacy) throw v2Res.status === 'rejected' ? v2Res.reason : new Error('no device data');
    const legacyByMac = new Map<string, RawDevice>();
    for (const d of legacy ?? []) {
      const mac = normalizeMac(d.mac);
      if (mac) legacyByMac.set(mac, d);
    }
    if (v2) return v2.map((d) => toDevice(d, legacyByMac.get(normalizeMac(d.mac)) ?? null));
    return (legacy ?? []).map((d) => toDevice(d, null));
  }

  /** Health subsystems from `/api/s/{site}/stat/health`. UniFi returns
   *  an array of entries keyed by `subsystem`. The `wan` subsystem
   *  carries multi-WAN data inside `uptime_stats` (keys `WAN`, `WAN2`,
   *  …) — we fan it out into per-WAN HealthSubsystem entries so the
   *  rest of the app can address `wan` and `wan2` symmetrically. The
   *  top-level `wan_ip` / `isp_name` / `asn` describe the primary WAN
   *  only and are only attached to the first emitted entry. */
  async getHealth(): Promise<HealthSubsystem[]> {
    if (this.mode !== 'legacy') return [];
    const r = await this.legacyGet<{ data?: RawHealthSubsystem[] }>(
      `/api/s/${this.opts.site}/stat/health`,
    );
    const out: HealthSubsystem[] = [];
    for (const raw of r.data ?? []) {
      const stats = raw.uptime_stats;
      if (raw.subsystem === 'wan' && stats && Object.keys(stats).length > 0) {
        const keys = Object.keys(stats).sort(); // WAN < WAN2 < WAN3 …
        keys.forEach((key, i) => {
          const isPrimary = i === 0;
          out.push(
            toHealthSubsystem({
              ...raw,
              subsystem: key.toLowerCase(),
              uptime_stats: { [key]: stats[key]! },
              ...(isPrimary
                ? {}
                : {
                    wan_ip: undefined,
                    isp_name: undefined,
                    isp_organization: undefined,
                    asn: undefined,
                  }),
            }),
          );
        });
      } else {
        out.push(toHealthSubsystem(raw));
      }
    }
    return out;
  }

  /** Per-WAN details from the gateway device entry. Keyed by uplink
   *  ifname (`eth9`, `eth10`, …). Returns `[]` outside legacy mode or
   *  when no gateway is reported. */
  async getWanDetails(): Promise<GatewayWanDetails[]> {
    if (this.mode !== 'legacy') return [];
    const gw = findGateway(await this.legacyDevices());
    if (!gw) return [];
    const ipv6Global = (gw.ipv6 ?? []).find((a) => !a.startsWith('fe80')) ?? null;
    const out: GatewayWanDetails[] = [];
    for (const w of [gw.wan1, gw.wan2]) {
      if (!w) continue;
      const ifName = w.uplink_ifname ?? w.ifname ?? w.name ?? '';
      if (!ifName) continue;
      const speed = num(w.speed);
      out.push({
        ifName,
        ip: w.ip ?? null,
        // gw.wan1.ipv6 is link-local only; the global prefix lives on the
        // gateway-level `ipv6` field, which we share across WANs since
        // the UDM doesn't break out per-WAN globals here.
        ipv6: ipv6Global,
        mac: w.mac ?? null,
        rxBytes: typeof w.rx_bytes === 'number' ? w.rx_bytes : 0,
        txBytes: typeof w.tx_bytes === 'number' ? w.tx_bytes : 0,
        latencyMs: num(w.latency),
        availabilityPct: num(w.availability),
        up: w.up === true,
        speedMbps: speed !== null && speed > 0 ? speed : null,
        uptimeSec: num(w.uptime),
      });
    }
    return out;
  }

  async getUdmInfo(): Promise<UdmInfo | null> {
    if (this.mode !== 'legacy') return null;
    // Hardware stats (cpu/mem/temp) live on the gateway *device* entry,
    // not on /stat/sysinfo (which is just controller/Network-app metadata).
    const gw = findGateway(await this.legacyDevices());
    if (!gw) return null;
    const stats = gw['system-stats'];
    const cpuTemp =
      gw.temperatures?.find((t) => t.type === 'cpu')?.value ??
      gw.temperatures?.[0]?.value ??
      gw.general_temperature ??
      null;
    const uptimeFromStats = stats?.uptime ? Number.parseInt(stats.uptime, 10) : NaN;
    return {
      name: gw.name ?? gw.hostname ?? 'UDM',
      model: gw.model ?? '',
      modelName: modelName(gw.model),
      firmware: gw.version ?? '',
      uptimeSec: Number.isFinite(uptimeFromStats) ? uptimeFromStats : (gw.uptime ?? 0),
      cpuPct: parsePct(stats?.cpu),
      memPct: parsePct(stats?.mem),
      tempC: cpuTemp,
    };
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function findGateway(devices: RawDevice[]): RawDevice | undefined {
  return devices.find(
    (d) =>
      d.is_gateway === true ||
      d.type === 'udm' ||
      d.type === 'ugw' ||
      (d.model ?? '').startsWith('UDM') ||
      (d.model ?? '').startsWith('UGW') ||
      (d.model ?? '').startsWith('UCG'),
  );
}

function toProbe(m: RawHealthMonitor): HealthSubsystem['monitors'][number] {
  return {
    target: m.target ?? '',
    type: m.type ?? 'unknown',
    latencyMs: typeof m.latency_average === 'number' ? m.latency_average : null,
    availabilityPct: typeof m.availability === 'number' ? m.availability : null,
  };
}

function toHealthSubsystem(h: RawHealthSubsystem): HealthSubsystem {
  const status: HealthSubsystem['status'] =
    h.status === 'ok' ? 'ok' : h.status === 'warning' ? 'warning' : 'unknown';
  // The wan/wan2 entries don't carry a top-level `latency`; instead the
  // current avg lives in `uptime_stats.{WAN,WAN2}.latency_average`. Pick
  // the bucket whose key matches this subsystem (case-insensitive).
  const bucket = (() => {
    const stats = h.uptime_stats;
    if (!stats) return null;
    const want = (h.subsystem ?? '').toUpperCase();
    return stats[want] ?? Object.values(stats)[0] ?? null;
  })();
  const monitors = [...(bucket?.alerting_monitors ?? []), ...(bucket?.monitors ?? [])].map(toProbe);
  const latencyFromBucket =
    typeof bucket?.latency_average === 'number' ? bucket.latency_average : null;
  return {
    name: h.subsystem ?? 'unknown',
    status,
    latencyMs:
      typeof h.latency === 'number' ? h.latency : latencyFromBucket,
    drops: typeof h.drops === 'number' ? h.drops : null,
    uptimeSec: typeof h.uptime === 'number' ? h.uptime : null,
    xputDownMbps: typeof h.xput_down === 'number' ? h.xput_down : null,
    xputUpMbps: typeof h.xput_up === 'number' ? h.xput_up : null,
    speedtestLastRunTs: typeof h.speedtest_lastrun === 'number' ? h.speedtest_lastrun : null,
    speedtestStatus: h.speedtest_status ?? null,
    numUser: typeof h.num_user === 'number' ? h.num_user : null,
    numGuest: typeof h.num_guest === 'number' ? h.num_guest : null,
    wanIp: h.wan_ip ?? null,
    availabilityPct:
      typeof bucket?.availability === 'number' ? bucket.availability : null,
    monitors,
    ispName: h.isp_name ?? null,
    ispOrg: h.isp_organization ?? null,
    asn: typeof h.asn === 'number' ? h.asn : null,
  };
}

function parsePct(v: string | undefined): number {
  if (!v) return 0;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** UniFi reports wireless PHY rates in Kbps; the UI wants Mbps. */
function scaleRate(kbps: number | null): number | null {
  if (kbps === null || kbps <= 0) return null;
  return Math.round(kbps / 1000);
}

function bandFromRadio(name: string | undefined, channel: number): Band {
  // UniFi tags radios as 'ng' (2.4G), 'na' (5G), '6e' (6G). Fall back to
  // channel-number heuristic when name is missing.
  if (name === '6e' || name?.startsWith('6')) return '6g';
  if (name === 'ng' || name === 'n') return '2g';
  if (name === 'na' || name === 'ac' || name === 'ax') return '5g';
  if (channel >= 1 && channel <= 14) return '2g';
  if (channel >= 32 && channel <= 177) return '5g';
  return '6g';
}

function normalizeMac(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase();
}

function neighborFromPort(p: RawPort): PortNeighbor | null {
  const flatChassis = normalizeMac(p.lldp_chassis_id);
  if (flatChassis) {
    return {
      chassisId: flatChassis,
      portId: p.lldp_port_id ?? null,
      systemName: p.lldp_system_name ?? null,
    };
  }
  const nested = p.lldp_table?.[0];
  if (nested) {
    const chassis = normalizeMac(nested.chassis_id);
    if (chassis) {
      return {
        chassisId: chassis,
        portId: nested.port_id ?? null,
        systemName: nested.system_name ?? null,
      };
    }
  }
  return null;
}

function poeWattsOf(p: RawPort | null | undefined): number {
  if (!p) return 0;
  const w = Number.parseFloat(String(p.poe_power ?? '0'));
  return Number.isFinite(w) && w > 0 ? w : 0;
}

function toPort(p: RawPort, lp: RawPort | null, deviceLldp: Map<number, PortNeighbor>): NetworkPort {
  const first = <K extends keyof RawPort>(k: K): RawPort[K] | undefined => p[k] ?? lp?.[k];
  const idx = p.port_idx ?? lp?.port_idx ?? 0;
  // Wattage: the legacy payload is authoritative (v2 omits it on current
  // firmware); fall back to whatever v2 carries.
  const poeWatts = poeWattsOf(lp) || poeWattsOf(p);
  const neighbor = neighborFromPort(p) ?? (lp ? neighborFromPort(lp) : null) ?? deviceLldp.get(idx) ?? null;
  const poeCapable = first('port_poe') === true;
  const poeEnable = first('poe_enable');
  return {
    idx,
    name: first('name') ?? `Port ${idx}`,
    up: first('up') === true,
    speedMbps: num(first('speed')) ?? 0,
    isUplink: first('is_uplink') === true,
    poeWatts,
    poeEnabled: poeCapable && poeEnable !== false,
    rxBps: num(first('rx_bytes-r')) ?? 0,
    txBps: num(first('tx_bytes-r')) ?? 0,
    rxBytes: num(first('rx_bytes')) ?? 0,
    txBytes: num(first('tx_bytes')) ?? 0,
    rxErrors: num(first('rx_errors')) ?? 0,
    txErrors: num(first('tx_errors')) ?? 0,
    rxDropped: num(first('rx_dropped')) ?? 0,
    txDropped: num(first('tx_dropped')) ?? 0,
    media: first('media') ?? null,
    fullDuplex: first('full_duplex') !== false,
    stpState: first('stp_state') ?? null,
    neighbor,
  };
}

function toRadio(r: RawRadioStats, lr: RawRadioStats | null, vapClients: { total: number; guest: number } | null): NetworkRadio {
  const first = <K extends keyof RawRadioStats>(k: K): RawRadioStats[K] | undefined => r[k] ?? lr?.[k];
  const channel = num(first('channel')) ?? 0;
  // Client counts: v2's radio stats report 0 on some firmwares; the legacy
  // stats or the VAP table (per-SSID counts, summed per radio) fill in.
  const counted = [r['user-num_sta'], r.num_sta, lr?.['user-num_sta'], lr?.num_sta].find((v) => typeof v === 'number' && v > 0);
  const numClients = counted ?? vapClients?.total ?? r.num_sta ?? lr?.num_sta ?? 0;
  const guest = first('guest-num_sta') ?? vapClients?.guest ?? 0;
  return {
    name: first('name') ?? first('radio') ?? '',
    band: bandFromRadio(first('radio'), channel),
    channel,
    bwMhz: num(first('bw')) ?? 0,
    numClients,
    guestClients: guest,
    utilizationPct: num(first('cu_total')) ?? 0,
    cuSelfRx: num(first('cu_self_rx')),
    cuSelfTx: num(first('cu_self_tx')),
    satisfaction: num(first('satisfaction')) ?? 0,
    txRetries: num(first('tx_retries')) ?? 0,
    txPackets: num(first('tx_packets')) ?? 0,
    txPowerDbm: num(first('tx_power')),
  };
}

/** Merge a v2 device entry with its legacy twin (either may be null). */
function toDevice(d: RawDevice | null, l: RawDevice | null): NetworkDevice {
  const v = d ?? l ?? {};
  const first = <K extends keyof RawDevice>(k: K): RawDevice[K] | undefined => d?.[k] ?? l?.[k];
  const stats = first('system-stats');
  const rawType = first('type');
  const type = (['uap', 'usw', 'udm', 'uci'] as const).includes(rawType as never)
    ? (rawType as NetworkDevice['type'])
    : rawType === 'ugw'
      ? 'udm'
      : 'other';

  // Device-level LLDP: v2 entries win when both endpoints supply data for the
  // same port; the legacy payload backfills ports where v2 is empty (the
  // common case on the cn10k gateway, where v2 returns no LLDP at all).
  const deviceLldp = new Map<number, PortNeighbor>();
  for (const e of [...(d?.lldp_table ?? []), ...(l?.lldp_table ?? [])]) {
    const idx = e.local_port_idx;
    const chassis = normalizeMac(e.chassis_id);
    if (typeof idx !== 'number' || !chassis || deviceLldp.has(idx)) continue;
    deviceLldp.set(idx, { chassisId: chassis, portId: e.port_id ?? null, systemName: e.system_name ?? null });
  }

  const legacyPorts = new Map<number, RawPort>();
  for (const p of l?.port_table ?? []) if (p.port_idx != null) legacyPorts.set(p.port_idx, p);
  const portSource = d?.port_table && d.port_table.length > 0 ? d.port_table : (l?.port_table ?? []);
  const ports = portSource.map((p) => toPort(p, legacyPorts.get(p.port_idx ?? -1) ?? null, deviceLldp));

  // Radios: merge v2 and legacy stats by radio code, and sum VAP client
  // counts per radio as a last resort for client numbers.
  const vapByRadio = new Map<string, { total: number; guest: number }>();
  for (const vap of [...(l?.vap_table ?? []), ...(d?.vap_table ?? [])]) {
    const key = vap.radio ?? vap.radio_name ?? '';
    if (!key) continue;
    const cur = vapByRadio.get(key) ?? { total: 0, guest: 0 };
    // The same VAP may appear in both payloads; keep the max rather than
    // double-counting.
    const n = vap.num_sta ?? 0;
    cur.total = Math.max(cur.total, n);
    if (vap.is_guest) cur.guest = Math.max(cur.guest, n);
    vapByRadio.set(key, cur);
  }
  const legacyRadios = l?.radio_table_stats ?? [];
  const radioSource = d?.radio_table_stats && d.radio_table_stats.length > 0 ? d.radio_table_stats : legacyRadios;
  const radios = radioSource.map((r) => {
    const twin = legacyRadios.find((x) => (x.radio && x.radio === r.radio) || (x.name && x.name === r.name)) ?? null;
    const vap = vapByRadio.get(r.radio ?? '') ?? vapByRadio.get(r.name ?? '') ?? null;
    return toRadio(r, twin === r ? null : twin, vap);
  });

  const uplinkRaw = first('uplink');
  const uplinkMac = normalizeMac(uplinkRaw?.uplink_mac);
  const uplink: PortNeighbor | null = uplinkMac
    ? {
        chassisId: uplinkMac,
        portId: uplinkRaw?.uplink_remote_port != null ? String(uplinkRaw.uplink_remote_port) : null,
        systemName: uplinkRaw?.uplink_device_name ?? null,
      }
    : null;

  // Switches report bytes-r=0 and rx/tx_bytes=0 at the device level; the
  // real numbers live on each port. Sum across ports when the device
  // total is empty. (Sum double-counts each frame — counted on both the
  // ingress and egress port — which matches how switch fabric throughput
  // is conventionally reported.)
  const portsBytesRate = ports.reduce((s, p) => s + p.rxBps + p.txBps, 0);
  const bytesRate = first('bytes-r') || portsBytesRate;
  const rxBytes = first('rx_bytes') || ports.reduce((s, p) => s + p.rxBytes, 0);
  const txBytes = first('tx_bytes') || ports.reduce((s, p) => s + p.txBytes, 0);
  const model = first('model') ?? '';
  const tempC =
    num(first('general_temperature')) ??
    num(first('temperatures')?.find((t) => t.type === 'cpu')?.value) ??
    num(first('temperatures')?.[0]?.value);
  const uplinkSpeed = num(uplinkRaw?.speed);

  return {
    id: v._id ?? first('_id') ?? first('mac') ?? '',
    type,
    name: first('name') ?? first('hostname') ?? first('mac') ?? '',
    model,
    modelName: modelName(model),
    ip: first('ip') ?? null,
    mac: normalizeMac(first('mac')),
    state: first('state') ?? 0,
    uptimeSec: first('uptime') ?? 0,
    lastSeen: num(first('last_seen')),
    firmware: first('version') ?? '',
    upgradable: first('upgradable') === true,
    numClients: first('num_sta') ?? 0,
    bytesRate,
    rxBytes,
    txBytes,
    satisfaction: first('satisfaction') ?? 0,
    cpuPct: stats?.cpu ? parsePct(stats.cpu) : null,
    memPct: stats?.mem ? parsePct(stats.mem) : null,
    tempC,
    overheating: first('overheating') === true,
    fanLevel: num(first('fan_level')),
    poeBudgetW: (() => {
      const b = num(first('total_max_power'));
      return b !== null && b > 0 ? b : null;
    })(),
    uplinkSpeedMbps: uplinkSpeed !== null && uplinkSpeed > 0 ? uplinkSpeed : null,
    ports,
    radios,
    uplink,
  };
}
