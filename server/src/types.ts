/** Wire types shared by the server and the web app.
 *
 *  This file is the single source of truth: `web/src/lib/types.ts` re-exports
 *  it (type-only), so a change here is picked up by both workspaces. Every
 *  field added after the initial design is optional-friendly on the client
 *  (the UI degrades when a field is missing) so an older server can still
 *  drive a newer UI during a rolling upgrade. */

/** `degraded` maps the controller's `warning` health state (e.g. failover
 *  active, packet loss on the monitors) — up, but not healthy. */
export type WanStatus = 'ok' | 'degraded' | 'down' | 'unknown';

export type HealthProbe = {
  /** Hostname or IP being probed (e.g. `www.microsoft.com`, `1.1.1.1`). */
  target: string;
  /** Probe type as reported by UniFi (`icmp`, `dns`, …). */
  type: string;
  /** Average latency in ms over the controller's monitoring window. */
  latencyMs: number | null;
  /** Probe success rate as a percent (0–100). */
  availabilityPct: number | null;
};

export type Wan = {
  id: string;
  ifIndex: number;
  ifName: string;
  label: string;
  /** Link speed in bits/s. Env override (`UDM_WAN_SPEEDS`) wins, then the
   *  controller's negotiated WAN port speed, then SNMP ifHighSpeed (which
   *  some UDM ports misreport). 0 when unknown. */
  speedBitsPerSec: number;
  /** Current throughput in BYTES per second (multiply by 8 for bits). */
  rxBps: number;
  txBps: number;
  rxTotal: number;
  txTotal: number;
  wanIp: string | null;
  /** First global IPv6 address advertised on the WAN, when present. */
  wanIpv6: string | null;
  status: WanStatus;
  latencyMs: number | null;
  /** Month-to-date rx/tx, accumulated from SNMP deltas and persisted to
   *  disk. Resets at the start of each calendar month (local time). */
  monthRxBytes: number;
  monthTxBytes: number;
  /** YYYY-MM label that monthRxBytes/monthTxBytes apply to. */
  monthLabel: string;
  /** Today's rx/tx (local calendar day), same accumulator as the month. */
  dayRxBytes: number;
  dayTxBytes: number;
  /** YYYY-MM-DD label for dayRxBytes/dayTxBytes. */
  dayLabel: string;
  /** Controller health for this WAN, folded in so the UI never has to
   *  correlate `health[]` entries by name. All null when the controller is
   *  unavailable. */
  ispName: string | null;
  ispOrg: string | null;
  asn: number | null;
  availabilityPct: number | null;
  uptimeSec: number | null;
  drops: number | null;
  monitors: HealthProbe[];
};

export type WanSample = {
  ts: number;
  rxBps: number;
  txBps: number;
  /** Best-effort upstream latency at the time of the sample. Null when
   *  no latency reading was available for this WAN at this tick. */
  latencyMs: number | null;
};

/** One calendar day of WAN usage (local time). */
export type DailyUsage = {
  /** YYYY-MM-DD */
  date: string;
  rxBytes: number;
  txBytes: number;
};

/** A subsystem report from UniFi's `/stat/health` endpoint, normalized.
 *  UniFi keys subsystems by name: `wan`, `wan2`, `www`, `lan`, `wlan`,
 *  `vpn`. Different subsystems carry different fields, so most numeric
 *  fields are nullable. */
export type HealthSubsystem = {
  name: string;
  status: 'ok' | 'warning' | 'unknown';
  /** Latency in ms (wan/www only). */
  latencyMs: number | null;
  /** Drops/errors over the controller's reporting window (wan/www). */
  drops: number | null;
  /** Subsystem uptime in seconds, when reported. */
  uptimeSec: number | null;
  /** Last speedtest down/up throughput, in Mbps (www only). */
  xputDownMbps: number | null;
  xputUpMbps: number | null;
  /** Unix seconds for the last speedtest run, if any (www only). */
  speedtestLastRunTs: number | null;
  /** Speedtest controller status string (`Idle`, `Running`, …). */
  speedtestStatus: string | null;
  /** Connected user/guest counts (lan/wlan). */
  numUser: number | null;
  numGuest: number | null;
  /** Public IP for this WAN (wan only). */
  wanIp: string | null;
  /** Per-WAN monitoring (wan/wan2 only). The controller samples a few
   *  upstream targets and reports rolling latency/availability. */
  availabilityPct: number | null;
  monitors: HealthProbe[];
  ispName: string | null;
  ispOrg: string | null;
  asn: number | null;
};

export type Band = '2g' | '5g' | '6g';

export type ClientStat = {
  id: string;
  name: string;
  ip: string | null;
  mac: string;
  /** Current throughput in BYTES per second. */
  rxBps: number;
  txBps: number;
  rxBytes: number;
  txBytes: number;
  isWired: boolean;
  isGuest: boolean;
  /** Wireless signal in dBm; null for wired clients. */
  signal: number | null;
  vendor: string | null;
  device: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  /** Network (VLAN) name the client sits on, when the controller reports it. */
  network: string | null;
  /** MAC of the UniFi device the client hangs off: the AP for wireless
   *  clients, the switch for wired ones. Lower-cased; null when unknown. */
  uplinkMac: string | null;
  /** Switch port for wired clients. */
  swPort: number | null;
  /** Radio band / channel / SSID for wireless clients. */
  band: Band | null;
  channel: number | null;
  essid: string | null;
  /** Negotiated PHY rates in Mbps (wireless), or link speed for wired. */
  rxRateMbps: number | null;
  txRateMbps: number | null;
  /** UniFi's 0–100 experience score, when reported. */
  satisfaction: number | null;
  uptimeSec: number | null;
};

export type DpiCategory = {
  id: string;
  name: string;
  bytes: number;
  pct: number;
};

export type UdmInfo = {
  name: string;
  /** Raw model code (e.g. `UDMPROMAX`). */
  model: string;
  /** Human-readable model name resolved from the catalog. */
  modelName: string;
  firmware: string;
  uptimeSec: number;
  cpuPct: number;
  memPct: number;
  tempC: number | null;
};

/** Normalized UPS power state, sourced from SNMP (RFC 1628 UPS-MIB, with
 *  APC PowerNet fallback). Every measurement is nullable because a given
 *  UPS may implement only part of the MIB. `reachable` is false when the
 *  UPS SNMP agent didn't answer this poll. */
export type UpsInfo = {
  reachable: boolean;
  manufacturer: string | null;
  model: string | null;
  batteryStatus: 'normal' | 'low' | 'depleted' | 'unknown';
  /** True when the UPS is running off its battery (mains lost). */
  onBattery: boolean;
  /** Seconds elapsed since the transfer to battery (0 when on mains). */
  secondsOnBattery: number | null;
  /** Estimated battery runtime remaining, in minutes. */
  minutesRemaining: number | null;
  /** Battery charge as a percent (0–100). */
  chargePct: number | null;
  batteryVoltage: number | null;
  batteryTempC: number | null;
  /** Incoming mains (line) RMS voltage and frequency. */
  inputVoltage: number | null;
  inputFrequencyHz: number | null;
  /** Where the UPS is currently drawing output power from. */
  outputSource: 'normal' | 'battery' | 'bypass' | 'booster' | 'reducer' | 'none' | 'other' | 'unknown';
  outputVoltage: number | null;
  outputFrequencyHz: number | null;
  outputCurrentA: number | null;
  /** Real output power in Watts, when the UPS reports it. */
  outputPowerW: number | null;
  /** Output load as a percent of the UPS's rated capacity. */
  loadPct: number | null;
};

export type PortNeighbor = {
  /** Lower-cased mac of the device on the other end of this link. */
  chassisId: string;
  /** Remote port identifier as reported via LLDP (often "Port N" or an ifname). */
  portId: string | null;
  /** Remote system name (hostname) as reported via LLDP. */
  systemName: string | null;
};

export type NetworkPort = {
  idx: number;
  name: string;
  up: boolean;
  speedMbps: number;
  isUplink: boolean;
  /** PoE draw in Watts (0 when not powering anything). */
  poeWatts: number;
  /** True when the port is PoE-capable and PoE is enabled on it. */
  poeEnabled: boolean;
  /** Current throughput in BYTES per second. */
  rxBps: number;
  txBps: number;
  rxBytes: number;
  txBytes: number;
  rxErrors: number;
  txErrors: number;
  rxDropped: number;
  txDropped: number;
  /** Port media as reported by the switch (`GE`, `SFP+`, …), when known. */
  media: string | null;
  fullDuplex: boolean;
  /** Spanning-tree state (`forwarding`, `disabled`, …), when known. */
  stpState: string | null;
  /** LLDP-discovered neighbor on this port, if any. */
  neighbor: PortNeighbor | null;
};

export type NetworkRadio = {
  name: string;
  band: Band;
  channel: number;
  bwMhz: number;
  numClients: number;
  guestClients: number;
  /** Channel utilization (airtime busy) as a percent. */
  utilizationPct: number;
  /** Airtime consumed by this radio's own rx/tx, when reported. */
  cuSelfRx: number | null;
  cuSelfTx: number | null;
  satisfaction: number;
  txRetries: number;
  txPackets: number;
  txPowerDbm: number | null;
};

export type DeviceType = 'uap' | 'usw' | 'udm' | 'uci' | 'other';

export type NetworkDevice = {
  id: string;
  type: DeviceType;
  name: string;
  /** Raw model code (`USWED72`). */
  model: string;
  /** Human-readable model name (`USW Pro XG 24 PoE`). */
  modelName: string;
  ip: string | null;
  mac: string;
  /** UniFi device state: 1 = connected. See `deviceStateLabel` on the client. */
  state: number;
  uptimeSec: number;
  lastSeen: number | null;
  firmware: string;
  upgradable: boolean;
  numClients: number;
  /** Device-level throughput in BYTES per second (sum of port rates for switches). */
  bytesRate: number;
  rxBytes: number;
  txBytes: number;
  satisfaction: number;
  cpuPct: number | null;
  memPct: number | null;
  tempC: number | null;
  overheating: boolean;
  fanLevel: number | null;
  /** Total PoE budget in Watts for PoE switches; null otherwise. */
  poeBudgetW: number | null;
  /** Negotiated speed of the device's uplink, in Mbps, when reported. */
  uplinkSpeedMbps: number | null;
  ports: NetworkPort[];
  radios: NetworkRadio[];
  /** For devices that don't expose per-port LLDP (typically APs), the
   *  upstream device they're cabled to. Comes from UniFi's `uplink`
   *  field on the device. */
  uplink: PortNeighbor | null;
};

/** Short-history samples kept server-side so sparklines are populated the
 *  moment a kiosk (re)loads, instead of filling in over the next hour. */
export type DeviceSample = {
  ts: number;
  /** BYTES per second. */
  bytesPerSec: number;
  clients: number;
};

export type GatewaySample = {
  ts: number;
  cpuPct: number;
  memPct: number;
  tempC: number | null;
  clients: number;
  wired: number;
  wireless: number;
};

export type UpsSample = {
  ts: number;
  loadPct: number | null;
  outputPowerW: number | null;
  inputVoltage: number | null;
  chargePct: number | null;
};

export type EventSeverity = 'info' | 'warn' | 'crit';

/** A state change the server noticed (device offline, WAN down, UPS on
 *  battery, controller unreachable…). Persisted so a restart doesn't wipe
 *  the "recent events" list on the kiosk. */
export type PanelEvent = {
  id: string;
  ts: number;
  severity: EventSeverity;
  /** Machine-readable kind, e.g. `device.offline`, `wan.down`, `ups.battery`. */
  kind: string;
  /** What the event is about (device name, WAN label, "UPS"…). */
  subject: string;
  message: string;
};

export type Features = {
  dpiAvailable: boolean;
  perClientRates: boolean;
  snmpAvailable: boolean;
  upsAvailable: boolean;
  /** True while the UniFi controller API is reachable. */
  controllerAvailable: boolean;
};

export type UiConfig = {
  /** Display name shown in the top bar. */
  siteName: string;
  /** Pages to rotate through (client page ids), or null for the default set. */
  pages: string[] | null;
  /** Auto-rotation dwell per page, in ms. */
  dwellMs: number;
};

export type Snapshot = {
  ts: number;
  source: 'live' | 'mock';
  serverUptimeSec: number;
  ui: UiConfig;
  wans: Wan[];
  histories: Record<string, WanSample[]>;
  /** Per-WAN daily usage for the trailing ~31 days, oldest first. */
  usageDaily: Record<string, DailyUsage[]>;
  clients: ClientStat[];
  dpi: DpiCategory[];
  dpiCategories: DpiCategory[];
  udm: UdmInfo | null;
  devices: NetworkDevice[];
  deviceHistories: Record<string, DeviceSample[]>;
  gatewayHistory: GatewaySample[];
  health: HealthSubsystem[];
  ups: UpsInfo | null;
  upsHistory: UpsSample[];
  events: PanelEvent[];
  features: Features;
};

export type Tick = {
  ts: number;
  wans: Wan[];
  samples: Array<{ id: string; rxBps: number; txBps: number; latencyMs: number | null }>;
  usageDaily?: Record<string, DailyUsage[]>;
  clients?: ClientStat[];
  dpi?: DpiCategory[];
  dpiCategories?: DpiCategory[];
  udm?: UdmInfo;
  devices?: NetworkDevice[];
  deviceSamples?: Array<{ id: string } & DeviceSample>;
  gatewaySample?: GatewaySample;
  health?: HealthSubsystem[];
  ups?: UpsInfo;
  upsSample?: UpsSample;
  /** Events raised during this tick (already appended to the log). */
  events?: PanelEvent[];
  /** Sent whenever a subsystem comes up or goes away. */
  features?: Features;
};

export type WsMessage =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'tick'; data: Tick }
  | { type: 'error'; message: string };
