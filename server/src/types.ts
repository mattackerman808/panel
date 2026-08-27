export type Wan = {
  id: string;
  ifIndex: number;
  ifName: string;
  label: string;
  speedBitsPerSec: number;
  rxBps: number;
  txBps: number;
  rxTotal: number;
  txTotal: number;
  wanIp: string | null;
  /** First global IPv6 address advertised on the WAN, when present. */
  wanIpv6: string | null;
  status: 'ok' | 'down' | 'unknown';
  latencyMs: number | null;
  /** Month-to-date rx/tx, accumulated from SNMP deltas and persisted to
   *  disk. Resets at the start of each calendar month (local time). */
  monthRxBytes: number;
  monthTxBytes: number;
  /** YYYY-MM label that monthRxBytes/monthTxBytes apply to. */
  monthLabel: string;
};

export type WanSample = {
  ts: number;
  rxBps: number;
  txBps: number;
  /** Best-effort upstream latency at the time of the sample. Null when
   *  no latency reading was available for this WAN at this tick. */
  latencyMs: number | null;
};

/** A subsystem report from UniFi's `/stat/health` endpoint, normalized.
 *  UniFi keys subsystems by name: `wan`, `wan2`, `www`, `lan`, `wlan`,
 *  `vpn`. Different subsystems carry different fields, so most numeric
 *  fields are nullable. */
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

export type ClientStat = {
  id: string;
  name: string;
  ip: string | null;
  mac: string;
  rxBps: number;
  txBps: number;
  rxBytes: number;
  txBytes: number;
  isWired: boolean;
  signal: number | null;
  vendor: string | null;
  device: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
};

export type DpiCategory = {
  id: string;
  name: string;
  bytes: number;
  pct: number;
};

export type UdmInfo = {
  name: string;
  model: string;
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
  poeWatts: number;
  rxBps: number;
  txBps: number;
  /** LLDP-discovered neighbor on this port, if any. */
  neighbor: PortNeighbor | null;
};

export type NetworkRadio = {
  name: string;
  band: '2g' | '5g' | '6g';
  channel: number;
  bwMhz: number;
  numClients: number;
  utilizationPct: number;
  satisfaction: number;
  txRetries: number;
  txPackets: number;
};

export type NetworkDevice = {
  id: string;
  type: 'uap' | 'usw' | 'udm' | 'uci' | 'other';
  name: string;
  model: string;
  ip: string | null;
  mac: string;
  state: number;
  uptimeSec: number;
  numClients: number;
  bytesRate: number;
  rxBytes: number;
  txBytes: number;
  satisfaction: number;
  cpuPct: number | null;
  memPct: number | null;
  tempC: number | null;
  ports: NetworkPort[];
  radios: NetworkRadio[];
  /** For devices that don't expose per-port LLDP (typically APs), the
   *  upstream device they're cabled to. Comes from UniFi's `uplink`
   *  field on the device. */
  uplink: PortNeighbor | null;
};

export type Snapshot = {
  ts: number;
  source: 'live' | 'mock';
  serverUptimeSec: number;
  wans: Wan[];
  histories: Record<string, WanSample[]>;
  clients: ClientStat[];
  dpi: DpiCategory[];
  dpiCategories: DpiCategory[];
  udm: UdmInfo | null;
  devices: NetworkDevice[];
  health: HealthSubsystem[];
  ups: UpsInfo | null;
  features: {
    dpiAvailable: boolean;
    perClientRates: boolean;
    snmpAvailable: boolean;
    upsAvailable: boolean;
  };
};

export type Tick = {
  ts: number;
  wans: Wan[];
  samples: Array<{ id: string; rxBps: number; txBps: number; latencyMs: number | null }>;
  clients?: ClientStat[];
  dpi?: DpiCategory[];
  dpiCategories?: DpiCategory[];
  udm?: UdmInfo;
  devices?: NetworkDevice[];
  health?: HealthSubsystem[];
  ups?: UpsInfo;
};

export type WsMessage =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'tick'; data: Tick }
  | { type: 'error'; message: string };
