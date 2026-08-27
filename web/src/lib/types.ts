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
  wanIpv6: string | null;
  status: 'ok' | 'down' | 'unknown';
  latencyMs: number | null;
  monthRxBytes: number;
  monthTxBytes: number;
  monthLabel: string;
};

export type WanSample = {
  ts: number;
  rxBps: number;
  txBps: number;
  latencyMs: number | null;
};

export type HealthProbe = {
  target: string;
  type: string;
  latencyMs: number | null;
  availabilityPct: number | null;
};

export type HealthSubsystem = {
  name: string;
  status: 'ok' | 'warning' | 'unknown';
  latencyMs: number | null;
  drops: number | null;
  uptimeSec: number | null;
  xputDownMbps: number | null;
  xputUpMbps: number | null;
  speedtestLastRunTs: number | null;
  speedtestStatus: string | null;
  numUser: number | null;
  numGuest: number | null;
  wanIp: string | null;
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

export type UpsInfo = {
  reachable: boolean;
  manufacturer: string | null;
  model: string | null;
  batteryStatus: 'normal' | 'low' | 'depleted' | 'unknown';
  onBattery: boolean;
  secondsOnBattery: number | null;
  minutesRemaining: number | null;
  chargePct: number | null;
  batteryVoltage: number | null;
  batteryTempC: number | null;
  inputVoltage: number | null;
  inputFrequencyHz: number | null;
  outputSource: 'normal' | 'battery' | 'bypass' | 'booster' | 'reducer' | 'none' | 'other' | 'unknown';
  outputVoltage: number | null;
  outputFrequencyHz: number | null;
  outputCurrentA: number | null;
  outputPowerW: number | null;
  loadPct: number | null;
};

export type PortNeighbor = {
  chassisId: string;
  portId: string | null;
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
  features: { dpiAvailable: boolean; perClientRates: boolean; snmpAvailable: boolean; upsAvailable: boolean };
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
