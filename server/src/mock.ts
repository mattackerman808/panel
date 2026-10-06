import { modelName } from './catalog.js';
import type {
  Band,
  ClientStat,
  DailyUsage,
  DpiCategory,
  EventSeverity,
  HealthSubsystem,
  NetworkDevice,
  NetworkPort,
  NetworkRadio,
  UdmInfo,
  UpsInfo,
  Wan,
} from './types.js';

/** Synthetic network modeled on the real fleet this dashboard was built for
 *  (one gateway, an aggregation switch feeding a core and a cabinet switch,
 *  seven leaf switches, six APs, ~100 clients) so the UI is exercised at the
 *  density it will see in production.
 *
 *  Everything is a pure function of the wall-clock time `t`, so the poller
 *  can replay the last 15 minutes at startup to pre-fill histories and get
 *  the same numbers it would have produced live. Jitter is hashed from the
 *  tick bucket rather than drawn from Math.random for the same reason. */

const DOMAIN = '808.org';

// --- deterministic helpers -------------------------------------------------

function hash(n: number): number {
  let x = Math.imul(n | 0, 0x45d9f3b);
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b);
  x = (x >>> 16) ^ x;
  return (x >>> 0) / 4294967296;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Slow-moving 0.15..1.1 envelope, deterministic in t (ms). */
function envelope(t: number, phase = 0): number {
  const s = t / 1000 + phase;
  return clamp(
    0.55 + 0.25 * Math.sin(s / 97) + 0.15 * Math.sin(s / 31 + 1.3) + 0.08 * Math.sin(s / 7.1 + 0.4),
    0.15,
    1.1,
  );
}

/** Per-tick jitter in [-1, 1], stable for a given (time bucket, seed). */
function jitter(t: number, seed: number, bucketMs = 2000): number {
  return hash(Math.floor(t / bucketMs) * 7919 + seed * 104729) * 2 - 1;
}

/** Occasional traffic bursts: a multiplier >= 1 for part of a 20s window. */
function burst(t: number, seed: number): number {
  const b = Math.floor(t / 20_000);
  const h = hash(b * 31 + seed);
  if (h < 0.16) {
    const within = (t % 20_000) / 20_000;
    return 1 + 7 * Math.sin(Math.PI * within) * (0.4 + h);
  }
  return 1;
}

function mac(prefix: string, i: number): string {
  return `${prefix}:${((i >> 8) & 255).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`;
}

function dayLabel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- fixtures ----------------------------------------------------------------

type SwitchFixture = {
  key: string;
  name: string;
  model: string;
  ports: number;
  /** SFP/SFP+ cages at the end of the port range (10G). */
  sfpPorts: number;
  rj45Mbps: number;
  poeBudget: number | null;
  uplinkTo: string;
  uplinkMbps: number;
  /** Ports to light up (live-fleet numbers), including uplink/downlinks. */
  upPorts: number;
};

const SWITCHES: SwitchFixture[] = [
  { key: 'agg', name: 'agg', model: 'USL8A', ports: 8, sfpPorts: 8, rj45Mbps: 0, poeBudget: null, uplinkTo: 'udm', uplinkMbps: 10000, upPorts: 6 },
  { key: 'core', name: 'core', model: 'USWED72', ports: 28, sfpPorts: 4, rj45Mbps: 2500, poeBudget: 400, uplinkTo: 'agg', uplinkMbps: 10000, upPorts: 18 },
  { key: 'cabinet', name: 'cabinet', model: 'USPM24P', ports: 26, sfpPorts: 2, rj45Mbps: 1000, poeBudget: 400, uplinkTo: 'agg', uplinkMbps: 10000, upPorts: 14 },
  { key: 'livingsw', name: 'livingsw', model: 'USPM16P', ports: 18, sfpPorts: 2, rj45Mbps: 1000, poeBudget: 180, uplinkTo: 'core', uplinkMbps: 10000, upPorts: 7 },
  { key: 'bnlsw2', name: 'bnlsw2', model: 'USWED37', ports: 10, sfpPorts: 2, rj45Mbps: 2500, poeBudget: 120, uplinkTo: 'core', uplinkMbps: 10000, upPorts: 4 },
  { key: 'desk10g', name: '10g-desksw', model: 'USFXG', ports: 5, sfpPorts: 0, rj45Mbps: 10000, poeBudget: null, uplinkTo: 'core', uplinkMbps: 10000, upPorts: 2 },
  { key: 'desk2g', name: '2g-desksw', model: 'USWED35', ports: 5, sfpPorts: 0, rj45Mbps: 2500, poeBudget: null, uplinkTo: 'core', uplinkMbps: 2500, upPorts: 3 },
  { key: 'desksw', name: 'desksw', model: 'USWED37', ports: 10, sfpPorts: 2, rj45Mbps: 2500, poeBudget: 120, uplinkTo: 'core', uplinkMbps: 10000, upPorts: 2 },
  { key: 'bnlsw', name: 'bnlsw', model: 'USWED35', ports: 5, sfpPorts: 0, rj45Mbps: 2500, poeBudget: null, uplinkTo: 'core', uplinkMbps: 2500, upPorts: 2 },
  { key: 'mainbedsw', name: 'mainbedsw', model: 'USWED35', ports: 5, sfpPorts: 0, rj45Mbps: 2500, poeBudget: null, uplinkTo: 'core', uplinkMbps: 2500, upPorts: 3 },
];

type ApFixture = {
  key: string;
  name: string;
  model: string;
  uplinkTo: string;
  clients: number;
  radios: Array<{ band: Band; channel: number; bw: number; util: number }>;
};

const APS: ApFixture[] = [
  { key: 'garage', name: 'garage-ap', model: 'U7PRO', uplinkTo: 'core', clients: 14, radios: [{ band: '2g', channel: 1, bw: 20, util: 38 }, { band: '5g', channel: 52, bw: 80, util: 3 }, { band: '6g', channel: 125, bw: 320, util: 2 }] },
  { key: 'backyard', name: 'backyard-ap', model: 'UKPW', uplinkTo: 'core', clients: 5, radios: [{ band: '2g', channel: 6, bw: 20, util: 51 }, { band: '5g', channel: 136, bw: 80, util: 2 }] },
  { key: 'dining', name: 'dining-ap', model: 'U7PRO', uplinkTo: 'core', clients: 8, radios: [{ band: '2g', channel: 1, bw: 20, util: 38 }, { band: '5g', channel: 104, bw: 80, util: 1 }, { band: '6g', channel: 209, bw: 320, util: 1 }] },
  { key: 'bnlroom', name: 'bnlroom-ap', model: 'U7PRO', uplinkTo: 'bnlsw2', clients: 5, radios: [{ band: '2g', channel: 1, bw: 20, util: 56 }, { band: '5g', channel: 40, bw: 80, util: 3 }, { band: '6g', channel: 109, bw: 320, util: 1 }] },
  { key: 'mainbed', name: 'mainbed-ap', model: 'U7PRO', uplinkTo: 'core', clients: 8, radios: [{ band: '2g', channel: 6, bw: 20, util: 47 }, { band: '5g', channel: 132, bw: 80, util: 1 }, { band: '6g', channel: 169, bw: 320, util: 2 }] },
  { key: 'living', name: 'living-ap', model: 'U7PRO', uplinkTo: 'core', clients: 9, radios: [{ band: '2g', channel: 11, bw: 20, util: 24 }, { band: '5g', channel: 153, bw: 80, util: 5 }, { band: '6g', channel: 37, bw: 320, util: 2 }] },
];

type ClientClass = 'server' | 'camera' | 'tv' | 'console' | 'pc' | 'iot' | 'phone' | 'audio' | 'infra';

type ClientFixture = { name: string; cls: ClientClass; vendor: string; device: string | null };

const WIRED_CLIENTS: ClientFixture[] = [
  { name: 'nas-01', cls: 'server', vendor: 'Synology Inc.', device: 'Synology NAS' },
  { name: 'nas-02', cls: 'server', vendor: 'Synology Inc.', device: 'Synology NAS' },
  { name: 'proxmox-01', cls: 'server', vendor: 'Super Micro Computer, Inc.', device: 'Server' },
  { name: 'proxmox-02', cls: 'server', vendor: 'Super Micro Computer, Inc.', device: 'Server' },
  { name: 'proxmox-03', cls: 'server', vendor: 'Dell Inc.', device: 'PowerEdge Server' },
  { name: 'plex', cls: 'server', vendor: 'Intel Corporate', device: 'NUC' },
  { name: 'homeassistant', cls: 'infra', vendor: 'Raspberry Pi Foundation', device: 'Home Assistant' },
  { name: 'protect-nvr', cls: 'server', vendor: 'Ubiquiti Inc.', device: 'UNVR' },
  { name: 'cam-front-door', cls: 'camera', vendor: 'Ubiquiti Inc.', device: 'G5 Bullet' },
  { name: 'cam-driveway', cls: 'camera', vendor: 'Ubiquiti Inc.', device: 'G5 Pro' },
  { name: 'cam-backyard', cls: 'camera', vendor: 'Ubiquiti Inc.', device: 'G5 Bullet' },
  { name: 'cam-garage', cls: 'camera', vendor: 'Ubiquiti Inc.', device: 'G4 Dome' },
  { name: 'cam-side-gate', cls: 'camera', vendor: 'Ubiquiti Inc.', device: 'G5 Turret' },
  { name: 'cam-pool', cls: 'camera', vendor: 'Ubiquiti Inc.', device: 'G5 Bullet' },
  { name: 'tv-living', cls: 'tv', vendor: 'LG Electronics', device: 'LG OLED TV' },
  { name: 'appletv-living', cls: 'tv', vendor: 'Apple, Inc.', device: 'Apple TV 4K' },
  { name: 'appletv-bedroom', cls: 'tv', vendor: 'Apple, Inc.', device: 'Apple TV 4K' },
  { name: 'appletv-bnl', cls: 'tv', vendor: 'Apple, Inc.', device: 'Apple TV 4K' },
  { name: 'shield-tv', cls: 'tv', vendor: 'NVIDIA', device: 'Shield TV' },
  { name: 'xbox-series-x', cls: 'console', vendor: 'Microsoft Corporation', device: 'Xbox Series X' },
  { name: 'ps5', cls: 'console', vendor: 'Sony Interactive Entertainment', device: 'PlayStation 5' },
  { name: 'desk-pc', cls: 'pc', vendor: 'ASUSTek Computer Inc.', device: 'Desktop PC' },
  { name: 'workstation-lab', cls: 'pc', vendor: 'Dell Inc.', device: 'Precision Workstation' },
  { name: 'mac-studio', cls: 'pc', vendor: 'Apple, Inc.', device: 'Mac Studio' },
  { name: 'printer-office', cls: 'iot', vendor: 'Brother Industries', device: 'Laser Printer' },
  { name: 'hue-bridge', cls: 'iot', vendor: 'Philips Lighting BV', device: 'Hue Bridge' },
  { name: 'pi-hole', cls: 'infra', vendor: 'Raspberry Pi Foundation', device: 'Raspberry Pi' },
  { name: 'pi-kiosk', cls: 'infra', vendor: 'Raspberry Pi Foundation', device: 'Raspberry Pi 5' },
  { name: 'sonos-amp-patio', cls: 'audio', vendor: 'Sonos, Inc.', device: 'Sonos Amp' },
  { name: 'denon-avr', cls: 'audio', vendor: 'D&M Holdings', device: 'Denon AVR' },
  { name: 'lutron-bridge', cls: 'iot', vendor: 'Lutron Electronics', device: 'Caséta Bridge' },
  { name: 'garage-door-hub', cls: 'iot', vendor: 'Chamberlain Group', device: 'myQ Hub' },
  { name: 'ipmi-proxmox-01', cls: 'infra', vendor: 'Super Micro Computer, Inc.', device: 'IPMI' },
  { name: 'ipmi-proxmox-02', cls: 'infra', vendor: 'Super Micro Computer, Inc.', device: 'IPMI' },
  { name: 'idrac-proxmox-03', cls: 'infra', vendor: 'Dell Inc.', device: 'iDRAC' },
  { name: 'ups-rmcard', cls: 'infra', vendor: 'Cyber Power Systems', device: 'RMCARD' },
  { name: 'pdu-rack', cls: 'infra', vendor: 'APC', device: 'Rack PDU' },
  { name: 'octoprint', cls: 'infra', vendor: 'Raspberry Pi Foundation', device: 'Raspberry Pi' },
  { name: 'k8s-node-1', cls: 'server', vendor: 'Intel Corporate', device: 'NUC' },
  { name: 'k8s-node-2', cls: 'server', vendor: 'Intel Corporate', device: 'NUC' },
  { name: 'k8s-node-3', cls: 'server', vendor: 'Intel Corporate', device: 'NUC' },
  { name: 'truenas-backup', cls: 'server', vendor: 'Super Micro Computer, Inc.', device: 'Server' },
  { name: 'pool-controller', cls: 'iot', vendor: 'Pentair', device: 'IntelliCenter' },
  { name: 'weather-station', cls: 'iot', vendor: 'Ambient Weather', device: 'Weather Station' },
  { name: 'tv-bnl', cls: 'tv', vendor: 'Samsung Electronics', device: 'Samsung TV' },
  { name: 'tv-garage', cls: 'tv', vendor: 'TCL', device: 'Roku TV' },
  { name: 'sonos-port', cls: 'audio', vendor: 'Sonos, Inc.', device: 'Sonos Port' },
  { name: 'lab-mgmt', cls: 'infra', vendor: 'Raspberry Pi Foundation', device: 'Raspberry Pi' },
];

const WIRELESS_CLIENTS: ClientFixture[] = [
  { name: 'iphone-matt', cls: 'phone', vendor: 'Apple, Inc.', device: 'iPhone 16 Pro' },
  { name: 'iphone-partner', cls: 'phone', vendor: 'Apple, Inc.', device: 'iPhone 15' },
  { name: 'ipad-kitchen', cls: 'phone', vendor: 'Apple, Inc.', device: 'iPad' },
  { name: 'ipad-kid', cls: 'phone', vendor: 'Apple, Inc.', device: 'iPad' },
  { name: 'macbook-pro', cls: 'pc', vendor: 'Apple, Inc.', device: 'MacBook Pro' },
  { name: 'macbook-air', cls: 'pc', vendor: 'Apple, Inc.', device: 'MacBook Air' },
  { name: 'pixel-9', cls: 'phone', vendor: 'Google, Inc.', device: 'Pixel 9' },
  { name: 'galaxy-s24', cls: 'phone', vendor: 'Samsung Electronics', device: 'Galaxy S24' },
  { name: 'apple-watch-matt', cls: 'iot', vendor: 'Apple, Inc.', device: 'Apple Watch' },
  { name: 'apple-watch-partner', cls: 'iot', vendor: 'Apple, Inc.', device: 'Apple Watch' },
  { name: 'homepod-living', cls: 'audio', vendor: 'Apple, Inc.', device: 'HomePod' },
  { name: 'homepod-kitchen', cls: 'audio', vendor: 'Apple, Inc.', device: 'HomePod mini' },
  { name: 'homepod-bnl', cls: 'audio', vendor: 'Apple, Inc.', device: 'HomePod mini' },
  { name: 'nest-thermostat', cls: 'iot', vendor: 'Google, Inc.', device: 'Nest Thermostat' },
  { name: 'nest-protect-hall', cls: 'iot', vendor: 'Google, Inc.', device: 'Nest Protect' },
  { name: 'nest-protect-garage', cls: 'iot', vendor: 'Google, Inc.', device: 'Nest Protect' },
  { name: 'ring-doorbell', cls: 'camera', vendor: 'Amazon Technologies Inc.', device: 'Ring Doorbell' },
  { name: 'ring-cam-side', cls: 'camera', vendor: 'Amazon Technologies Inc.', device: 'Ring Stick Up Cam' },
  { name: 'echo-kitchen', cls: 'audio', vendor: 'Amazon Technologies Inc.', device: 'Echo Dot' },
  { name: 'echo-bedroom', cls: 'audio', vendor: 'Amazon Technologies Inc.', device: 'Echo Dot' },
  { name: 'echo-office', cls: 'audio', vendor: 'Amazon Technologies Inc.', device: 'Echo Show' },
  { name: 'roku-guest', cls: 'tv', vendor: 'Roku, Inc.', device: 'Roku Streaming Stick' },
  { name: 'fire-tv-garage', cls: 'tv', vendor: 'Amazon Technologies Inc.', device: 'Fire TV Stick' },
  { name: 'kindle', cls: 'phone', vendor: 'Amazon Technologies Inc.', device: 'Kindle' },
  { name: 'sonos-move', cls: 'audio', vendor: 'Sonos, Inc.', device: 'Sonos Move' },
  { name: 'sonos-roam', cls: 'audio', vendor: 'Sonos, Inc.', device: 'Sonos Roam' },
  { name: 'plug-coffee', cls: 'iot', vendor: 'Meross', device: 'Smart Plug' },
  { name: 'plug-lamp', cls: 'iot', vendor: 'Meross', device: 'Smart Plug' },
  { name: 'plug-heater', cls: 'iot', vendor: 'Meross', device: 'Smart Plug' },
  { name: 'wyze-cam-garage', cls: 'camera', vendor: 'Wyze Labs', device: 'Wyze Cam' },
  { name: 'robot-vacuum', cls: 'iot', vendor: 'Roborock', device: 'Robot Vacuum' },
  { name: 'litter-robot', cls: 'iot', vendor: 'Whisker', device: 'Litter-Robot' },
  { name: 'ecobee-sensor', cls: 'iot', vendor: 'ecobee', device: 'SmartSensor' },
  { name: 'rachio', cls: 'iot', vendor: 'Rachio', device: 'Irrigation Controller' },
  { name: 'tesla-model-y', cls: 'iot', vendor: 'Tesla Motors', device: 'Model Y' },
  { name: 'ev-charger', cls: 'iot', vendor: 'Tesla Motors', device: 'Wall Connector' },
  { name: 'traeger', cls: 'iot', vendor: 'Traeger', device: 'Pellet Grill' },
  { name: 'govee-lights', cls: 'iot', vendor: 'Govee', device: 'LED Strip' },
  { name: 'nanoleaf', cls: 'iot', vendor: 'Nanoleaf', device: 'Light Panels' },
  { name: 'meta-quest-3', cls: 'console', vendor: 'Meta Platforms', device: 'Quest 3' },
  { name: 'steam-deck', cls: 'console', vendor: 'Valve Corporation', device: 'Steam Deck' },
  { name: 'ipad-pro', cls: 'phone', vendor: 'Apple, Inc.', device: 'iPad Pro' },
  { name: 'thinkpad-work', cls: 'pc', vendor: 'Lenovo', device: 'ThinkPad' },
  { name: 'dell-xps', cls: 'pc', vendor: 'Dell Inc.', device: 'XPS 15' },
  { name: 'framework-laptop', cls: 'pc', vendor: 'Framework Computer', device: 'Framework 13' },
  { name: 'pixel-tablet', cls: 'phone', vendor: 'Google, Inc.', device: 'Pixel Tablet' },
  { name: 'garmin-watch', cls: 'iot', vendor: 'Garmin International', device: 'Garmin Watch' },
  { name: 'withings-scale', cls: 'iot', vendor: 'Withings', device: 'Body Scale' },
  { name: 'guest-phone', cls: 'phone', vendor: 'OnePlus Technology', device: 'OnePlus 12' },
];

const CLASS_RATE: Record<ClientClass, { rx: number; tx: number; steady: boolean }> = {
  server: { rx: 900_000, tx: 2_400_000, steady: false },
  camera: { rx: 20_000, tx: 480_000, steady: true },
  tv: { rx: 2_600_000, tx: 60_000, steady: false },
  console: { rx: 1_200_000, tx: 120_000, steady: false },
  pc: { rx: 700_000, tx: 260_000, steady: false },
  iot: { rx: 4_000, tx: 2_500, steady: true },
  phone: { rx: 240_000, tx: 60_000, steady: false },
  audio: { rx: 180_000, tx: 12_000, steady: true },
  infra: { rx: 25_000, tx: 40_000, steady: true },
};

const CLASS_NETWORK: Record<ClientClass, string> = {
  server: 'Servers',
  camera: 'Cameras',
  tv: 'Media',
  console: 'Media',
  pc: 'LAN',
  iot: 'IoT',
  phone: 'LAN',
  audio: 'Media',
  infra: 'Management',
};

const DPI_CATEGORY_FIXTURES = [
  { name: 'Network protocols', weight: 67.5 },
  { name: 'Web services', weight: 15.4 },
  { name: 'Media streaming services', weight: 10.1 },
  { name: 'Unknown', weight: 1.5 },
  { name: 'Social networks', weight: 1.3 },
  { name: 'File sharing services and tools', weight: 1.1 },
  { name: 'Remote access terminals', weight: 0.9 },
  { name: 'Security update tools', weight: 0.5 },
  { name: 'Games', weight: 0.4 },
  { name: 'Mail and collaboration', weight: 0.3 },
];

const DPI_APP_FIXTURES = [
  { name: 'SSL/TLS', weight: 59.5 },
  { name: 'Speedtest.net', weight: 15.8 },
  { name: 'rsync', weight: 7.4 },
  { name: 'YouTube', weight: 4.8 },
  { name: 'Radio streaming services', weight: 1.7 },
  { name: 'iCloud', weight: 1.5 },
  { name: 'Netflix', weight: 1.3 },
  { name: 'Unknown', weight: 1.3 },
  { name: 'Apple TV+', weight: 0.9 },
  { name: 'Steam', weight: 0.8 },
  { name: 'Plex', weight: 0.7 },
  { name: 'Zoom', weight: 0.5 },
  { name: 'GitHub', weight: 0.4 },
  { name: 'Spotify', weight: 0.4 },
];

// --- world -------------------------------------------------------------------

type PortShell = {
  idx: number;
  name: string;
  media: string;
  speedMbps: number;
  isUplink: boolean;
  /** What hangs off this port: another switch/AP (by key), a wired client (index), or nothing. */
  link: { kind: 'device'; key: string } | { kind: 'client'; idx: number } | null;
  poeWatts: number;
};

type DeviceShell = {
  key: string;
  kind: 'udm' | 'uci' | 'usw' | 'uap';
  name: string;
  model: string;
  mac: string;
  ip: string;
  uplinkTo: string | null;
  uplinkMbps: number;
  ports: PortShell[];
  ap: ApFixture | null;
  sw: SwitchFixture | null;
  /** Wired client indexes attached directly (for `numClients`). */
  wiredClients: number[];
};

type ClientShell = ClientFixture & {
  idx: number;
  isWired: boolean;
  mac: string;
  ip: string;
  attachedTo: string; // device key
  swPort: number | null;
  band: Band | null;
  channel: number | null;
  essid: string | null;
  isGuest: boolean;
  signal: number | null;
  rate: number | null;
  seed: number;
  firstSeen: number;
};

const UDM_KEY = 'udm';
const UCI_KEY = 'modem';
const WAN_FIXTURES = [
  { id: 'wan1', label: 'ATT Fiber', ifName: 'eth12', ifIndex: 14, speed: 10_000_000_000, baseRx: 24_000_000, baseTx: 5_500_000, ip: '203.0.113.42', ipv6: '2600:1700:5451:1cf0::1', isp: { name: 'AT&T Internet', org: 'AT&T Enterprises, LLC', asn: 7018 }, latency: 5, dayRx: 120e9, dayTx: 18e9 },
  { id: 'wan2', label: 'Xfinity', ifName: 'eth8', ifIndex: 10, speed: 2_500_000_000, baseRx: 900_000, baseTx: 220_000, ip: '198.51.100.7', ipv6: null, isp: { name: 'Xfinity / Comcast', org: 'Comcast Cable Communications, LLC', asn: 7922 }, latency: 12, dayRx: 9e9, dayTx: 1.5e9 },
];

export type MockWorld = ReturnType<typeof createMockWorld>;

export function createMockWorld() {
  const startedAt = Date.now();
  const devices = new Map<string, DeviceShell>();
  const clients: ClientShell[] = [];

  // Gateway + modem
  devices.set(UDM_KEY, {
    key: UDM_KEY, kind: 'udm', name: `unifi.${DOMAIN}`, model: 'UDMPROMAX', mac: mac('d0:21:f9:a0', 1), ip: '10.80.0.1',
    uplinkTo: null, uplinkMbps: 0, ap: null, sw: null, wiredClients: [],
    ports: Array.from({ length: 14 }, (_, i) => ({
      idx: i + 1, name: `Port ${i + 1}`, media: i >= 8 ? 'SFP+' : 'GE', speedMbps: 0, isUplink: false, link: null, poeWatts: 0,
    })),
  });
  devices.set(UCI_KEY, {
    key: UCI_KEY, kind: 'uci', name: 'Cable Modem', model: 'UCI', mac: mac('d0:21:f9:a0', 2), ip: '192.168.100.1',
    uplinkTo: null, uplinkMbps: 0, ap: null, sw: null, wiredClients: [],
    ports: [{ idx: 1, name: 'Port 1', media: 'GE', speedMbps: 2500, isUplink: false, link: null, poeWatts: 0 }],
  });

  // Switches
  SWITCHES.forEach((s, i) => {
    const ports: PortShell[] = Array.from({ length: s.ports }, (_, p) => {
      const idx = p + 1;
      const isSfp = idx > s.ports - s.sfpPorts;
      return {
        idx,
        name: isSfp ? `SFP+ ${idx}` : `Port ${idx}`,
        media: isSfp ? 'SFP+' : s.rj45Mbps >= 10000 ? '10GE' : s.rj45Mbps >= 2500 ? '2.5GE' : 'GE',
        speedMbps: 0,
        isUplink: false,
        link: null,
        poeWatts: 0,
      };
    });
    devices.set(s.key, {
      key: s.key, kind: 'usw', name: `${s.name}.${DOMAIN}`, model: s.model, mac: mac('d0:21:f9:b0', i + 1), ip: `10.80.1.${10 + i}`,
      uplinkTo: s.uplinkTo, uplinkMbps: s.uplinkMbps, ap: null, sw: s, wiredClients: [], ports,
    });
  });
  // APs (no ports of their own)
  APS.forEach((a, i) => {
    devices.set(a.key, {
      key: a.key, kind: 'uap', name: `${a.name}.${DOMAIN}`, model: a.model, mac: mac('d0:21:f9:c0', i + 1), ip: `10.80.1.${40 + i}`,
      uplinkTo: a.uplinkTo, uplinkMbps: 2500, ap: a, sw: null, wiredClients: [], ports: [],
    });
  });

  // --- cabling ---------------------------------------------------------------
  const takePort = (dev: DeviceShell, preferSfp: boolean): PortShell | null => {
    const free = dev.ports.filter((p) => !p.link && !p.isUplink);
    const sfp = free.filter((p) => p.media === 'SFP+');
    const rj = free.filter((p) => p.media !== 'SFP+');
    const pick = preferSfp ? (sfp[0] ?? rj[0]) : (rj[0] ?? sfp[0]);
    return pick ?? null;
  };
  const uplinkPort = (dev: DeviceShell): PortShell | null => {
    if (dev.ports.length === 0) return null;
    const sfp = dev.ports.filter((p) => p.media === 'SFP+');
    return sfp.length > 0 ? sfp[sfp.length - 1]! : dev.ports[0]!;
  };

  // UDM LAN port to the aggregation switch; WAN ports light up too.
  const udm = devices.get(UDM_KEY)!;
  udm.ports[12]!.speedMbps = 10000; // eth12 → fiber
  udm.ports[8]!.speedMbps = 2500; // eth8 → cable
  udm.ports[10]!.link = { kind: 'device', key: 'agg' };
  udm.ports[10]!.speedMbps = 10000;

  for (const s of SWITCHES) {
    const dev = devices.get(s.key)!;
    const up = uplinkPort(dev)!;
    up.isUplink = true;
    up.speedMbps = s.uplinkMbps;
    up.link = { kind: 'device', key: s.uplinkTo };
    if (s.uplinkTo !== UDM_KEY) {
      const parent = devices.get(s.uplinkTo)!;
      const pp = takePort(parent, s.uplinkMbps >= 10000);
      if (pp) {
        pp.link = { kind: 'device', key: s.key };
        pp.speedMbps = Math.min(s.uplinkMbps, pp.media === 'SFP+' ? 10000 : parent.sw?.rj45Mbps ?? 1000);
      }
    }
  }
  for (const a of APS) {
    const parent = devices.get(a.uplinkTo)!;
    const pp = takePort(parent, false);
    if (pp) {
      pp.link = { kind: 'device', key: a.key };
      pp.speedMbps = Math.min(2500, parent.sw?.rj45Mbps ?? 1000);
      pp.poeWatts = a.model === 'UKPW' ? 6.4 : 9.8 + hash(a.key.length * 17) * 3;
    }
  }

  // --- clients ---------------------------------------------------------------
  const wiredSlots: Array<{ devKey: string; port: PortShell }> = [];
  for (const s of SWITCHES) {
    const dev = devices.get(s.key)!;
    const used = dev.ports.filter((p) => p.link || p.isUplink).length;
    let remaining = Math.max(0, s.upPorts - used);
    for (const p of dev.ports) {
      if (remaining <= 0) break;
      if (p.link || p.isUplink) continue;
      wiredSlots.push({ devKey: s.key, port: p });
      remaining--;
    }
  }
  // The wired client list is longer than the live port budget; the surplus
  // simply isn't plugged in, so port counts match the real fleet.
  WIRED_CLIENTS.forEach((c, i) => {
    const slot = wiredSlots[i];
    if (!slot) return;
    const dev = devices.get(slot.devKey)!;
    slot.port.link = { kind: 'client', idx: clients.length };
    slot.port.speedMbps = c.cls === 'server' ? Math.min(10000, dev.sw?.rj45Mbps ?? 1000) : Math.min(1000, dev.sw?.rj45Mbps ?? 1000);
    if (c.cls === 'camera') slot.port.poeWatts = 4.2 + hash(i * 3) * 2.5;
    dev.wiredClients.push(clients.length);
    clients.push({
      ...c, idx: clients.length, isWired: true, mac: mac('3c:22:fb:10', i + 1), ip: `10.80.${c.cls === 'camera' ? 30 : c.cls === 'iot' ? 20 : 10}.${20 + i}`,
      attachedTo: slot.devKey, swPort: slot.port.idx, band: null, channel: null, essid: null, isGuest: false, signal: null,
      rate: slot.port.speedMbps, seed: 1000 + i, firstSeen: Math.floor(startedAt / 1000) - 86400 * (3 + (i % 40)),
    });
  });
  let wi = 0;
  for (const a of APS) {
    const dev = devices.get(a.key)!;
    for (let k = 0; k < a.clients && wi < WIRELESS_CLIENTS.length; k++, wi++) {
      const c = WIRELESS_CLIENTS[wi]!;
      const has6 = a.radios.some((r) => r.band === '6g');
      const roll = hash(wi * 11 + 5);
      const band: Band = c.cls === 'iot' || c.cls === 'audio' ? (roll < 0.75 ? '2g' : '5g') : has6 && roll < 0.35 ? '6g' : roll < 0.85 ? '5g' : '2g';
      const radio = a.radios.find((r) => r.band === band) ?? a.radios[0]!;
      const isGuest = c.name === 'guest-phone';
      const signal = -(42 + Math.round(hash(wi * 7 + 1) * 34) + (band === '2g' ? 0 : 4));
      const rate = band === '6g' ? 1201 + Math.round(hash(wi) * 1200) : band === '5g' ? 433 + Math.round(hash(wi + 1) * 800) : 72 + Math.round(hash(wi + 2) * 200);
      clients.push({
        ...c, idx: clients.length, isWired: false, mac: mac('f0:2f:4b:20', wi + 1), ip: `10.80.${c.cls === 'iot' ? 20 : isGuest ? 90 : 10}.${120 + wi}`,
        attachedTo: a.key, swPort: null, band, channel: radio.channel, essid: isGuest ? 'Hale808-Guest' : c.cls === 'iot' ? 'Hale808-IoT' : 'Hale808', isGuest, signal,
        rate, seed: 2000 + wi, firstSeen: Math.floor(startedAt / 1000) - 86400 * (1 + (wi % 90)),
      });
    }
  }

  // --- per-tick state ----------------------------------------------------------

  /** bnlsw drops off the controller for 50s every 20 minutes, so the alert
   *  strip and the event log get exercised without flooding them. */
  const switchOffline = (key: string, t: number): boolean => key === 'bnlsw' && (t / 60_000) % 20 < 0.84;
  /** garage-ap's 2.4 GHz radio gets congested for a minute every 10. */
  const congested = (key: string, t: number): boolean => key === 'garage' && (t / 60_000) % 10 >= 2 && (t / 60_000) % 10 < 3.2;

  function clientRates(c: ClientShell, t: number): { rx: number; tx: number } {
    const base = CLASS_RATE[c.cls];
    const env = base.steady ? 0.85 + 0.15 * envelope(t, c.seed) : envelope(t, c.seed) * (0.6 + 0.8 * hash(c.seed + Math.floor(t / 60_000)));
    const j = 1 + 0.25 * jitter(t, c.seed);
    const b = base.steady ? 1 : burst(t, c.seed);
    return { rx: Math.max(0, base.rx * env * j * b), tx: Math.max(0, base.tx * env * j * (b > 1 ? 1 + (b - 1) * 0.3 : 1)) };
  }

  /** Throughput (bytes/s, rx+tx) flowing through a device's downstream side. */
  const subtreeRate = new Map<string, { rx: number; tx: number }>();
  function computeRates(t: number): void {
    subtreeRate.clear();
    const order = [...devices.values()].filter((d) => d.kind !== 'udm' && d.kind !== 'uci').reverse();
    // APs first (leaves), then switches bottom-up: the fixture order lists
    // parents before children, so reversing processes children first.
    for (const d of order) {
      let rx = 0;
      let tx = 0;
      if (d.kind === 'uap' && d.ap) {
        for (const c of clients) if (!c.isWired && c.attachedTo === d.key) { const r = clientRates(c, t); rx += r.rx; tx += r.tx; }
      } else {
        for (const p of d.ports) {
          if (!p.link || p.isUplink) continue;
          if (p.link.kind === 'client') { const r = clientRates(clients[p.link.idx]!, t); rx += r.rx; tx += r.tx; }
          else { const sub = subtreeRate.get(p.link.key); if (sub) { rx += sub.rx; tx += sub.tx; } }
        }
      }
      subtreeRate.set(d.key, { rx, tx });
    }
  }

  function portRate(d: DeviceShell, p: PortShell, t: number): { rx: number; tx: number } {
    if (!p.link) return { rx: 0, tx: 0 };
    if (p.isUplink) {
      const sub = subtreeRate.get(d.key) ?? { rx: 0, tx: 0 };
      // From the uplink port's perspective, downstream download is this port's rx.
      return { rx: sub.rx, tx: sub.tx };
    }
    if (p.link.kind === 'client') { const r = clientRates(clients[p.link.idx]!, t); return { rx: r.tx, tx: r.rx }; }
    const sub = subtreeRate.get(p.link.key) ?? { rx: 0, tx: 0 };
    return { rx: sub.tx, tx: sub.rx };
  }

  function buildPort(d: DeviceShell, p: PortShell, t: number, deviceUp: boolean): NetworkPort {
    const linkedDev = p.link?.kind === 'device' ? devices.get(p.link.key) ?? null : null;
    const linkedDown = linkedDev && linkedDev.kind === 'usw' ? switchOffline(linkedDev.key, t) : false;
    const up = deviceUp && (!!p.link || p.speedMbps > 0) && !linkedDown;
    const r = up ? portRate(d, p, t) : { rx: 0, tx: 0 };
    const errors = p.idx === 3 && d.key === 'cabinet' ? 1842 : 0;
    return {
      idx: p.idx,
      name: p.name,
      up,
      speedMbps: up ? p.speedMbps : 0,
      isUplink: p.isUplink,
      poeWatts: up ? p.poeWatts * (0.96 + 0.04 * hash(Math.floor(t / 15_000) + p.idx)) : 0,
      poeEnabled: p.media !== 'SFP+' && (d.sw?.poeBudget ?? 0) > 0,
      rxBps: r.rx,
      txBps: r.tx,
      rxBytes: up ? 4e9 + p.idx * 7e8 + (r.rx * (t - startedAt)) / 1000 : 0,
      txBytes: up ? 3e9 + p.idx * 5e8 + (r.tx * (t - startedAt)) / 1000 : 0,
      rxErrors: errors,
      txErrors: 0,
      rxDropped: errors > 0 ? 97 : 0,
      txDropped: 0,
      media: p.media,
      fullDuplex: true,
      stpState: up ? 'forwarding' : 'disabled',
      neighbor:
        linkedDev && (linkedDev.kind === 'usw' || linkedDev.kind === 'udm' || linkedDev.kind === 'uap')
          ? { chassisId: linkedDev.mac, portId: p.isUplink ? null : `Port ${p.idx}`, systemName: linkedDev.name }
          : null,
    };
  }

  function buildRadios(a: ApFixture, key: string, t: number): NetworkRadio[] {
    const attached = clients.filter((c) => !c.isWired && c.attachedTo === key);
    return a.radios.map((r, i) => {
      const n = attached.filter((c) => c.band === r.band).length;
      const guest = attached.filter((c) => c.band === r.band && c.isGuest).length;
      const congestion = r.band === '2g' && congested(key, t) ? 38 : 0;
      const util = clamp(r.util + congestion + 6 * jitter(t, i + key.length, 15_000), 0, 100);
      const retries = Math.round((r.band === '2g' ? 0.08 : 0.025) * (1 + congestion / 40) * 400_000);
      return {
        name: r.band === '2g' ? 'ng' : r.band === '5g' ? 'na' : '6e',
        band: r.band,
        channel: r.channel,
        bwMhz: r.bw,
        numClients: n,
        guestClients: guest,
        utilizationPct: util,
        cuSelfRx: util * 0.3,
        cuSelfTx: util * 0.2,
        satisfaction: clamp(98 - congestion * 0.8 - (r.band === '2g' ? 6 : 0), 0, 100),
        txRetries: retries,
        txPackets: 400_000,
        txPowerDbm: r.band === '2g' ? 20 : 23,
      };
    });
  }

  function buildDevice(d: DeviceShell, t: number): NetworkDevice {
    const offline = d.kind === 'usw' && switchOffline(d.key, t);
    const upState = offline ? 0 : 1;
    const ports = d.ports.map((p) => buildPort(d, p, t, !offline));
    const radios = d.ap ? buildRadios(d.ap, d.key, t) : [];
    const sub = subtreeRate.get(d.key) ?? { rx: 0, tx: 0 };
    const seed = d.key.length * 31 + d.name.charCodeAt(0);
    const bytesRate = d.kind === 'usw' ? ports.reduce((s, p) => s + p.rxBps + p.txBps, 0) : sub.rx + sub.tx;
    const parent = d.uplinkTo ? devices.get(d.uplinkTo) ?? null : null;
    const parentPort = parent?.ports.find((p) => p.link?.kind === 'device' && p.link.key === d.key) ?? null;
    const clientsOn = d.kind === 'uap' ? radios.reduce((s, r) => s + r.numClients, 0) : d.wiredClients.length + ports.filter((p) => p.up && p.neighbor && !p.isUplink).length;
    return {
      id: `mock-${d.key}`,
      type: d.kind,
      name: d.name,
      model: d.model,
      modelName: modelName(d.model),
      ip: d.ip,
      mac: d.mac,
      state: upState,
      uptimeSec: offline ? 0 : 1_900_000 + seed * 1000 + Math.floor((t - startedAt) / 1000),
      lastSeen: Math.floor(t / 1000),
      firmware: d.kind === 'uap' ? '7.2.26' : d.kind === 'usw' ? '7.2.26' : d.kind === 'udm' ? '5.1.33' : '1.0.2',
      upgradable: d.key === 'cabinet',
      numClients: offline ? 0 : clientsOn,
      bytesRate: offline ? 0 : bytesRate,
      rxBytes: 40e9 + seed * 1e9,
      txBytes: 32e9 + seed * 8e8,
      satisfaction: d.kind === 'uap' ? Math.round(radios.reduce((s, r) => s + r.satisfaction, 0) / Math.max(1, radios.length)) : 100,
      cpuPct: offline ? null : clamp((d.kind === 'uap' ? 2 : d.key === 'desk10g' ? 46 : 9) + 4 * envelope(t, seed) + 2 * jitter(t, seed, 15_000), 0, 100),
      memPct: offline ? null : clamp((d.kind === 'uap' ? 48 : 31) + 3 * jitter(t, seed + 1, 60_000), 0, 100),
      tempC: d.kind === 'usw' && d.sw?.poeBudget ? 46 + 5 * envelope(t, seed) : d.kind === 'udm' ? 45 + 2 * envelope(t, seed) : null,
      overheating: false,
      fanLevel: d.kind === 'udm' ? 2 : null,
      poeBudgetW: d.sw?.poeBudget ?? null,
      uplinkSpeedMbps: d.uplinkMbps || null,
      ports,
      radios,
      uplink:
        d.kind === 'uap' && parent
          ? { chassisId: parent.mac, portId: parentPort ? String(parentPort.idx) : null, systemName: parent.name }
          : d.kind === 'udm'
            ? { chassisId: devices.get(UCI_KEY)!.mac, portId: null, systemName: 'Cable Modem' }
            : null,
    };
  }

  // --- public API --------------------------------------------------------------

  function wans(t: number): Wan[] {
    const now = new Date(t);
    const monthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const daily = usageDaily(t);
    return WAN_FIXTURES.map((w, i) => {
      const env = envelope(t, i * 3.7);
      const rx = Math.max(0, w.baseRx * env * burst(t, 50 + i) * (1 + 0.2 * jitter(t, 60 + i)));
      const tx = Math.max(0, w.baseTx * env * (1 + 0.2 * jitter(t, 70 + i)));
      const days = daily[w.id] ?? [];
      const today = days[days.length - 1];
      const month = days.filter((d) => d.date.startsWith(monthLabel));
      return {
        id: w.id,
        ifIndex: w.ifIndex,
        ifName: w.ifName,
        label: w.label,
        speedBitsPerSec: w.speed,
        rxBps: rx,
        txBps: tx,
        rxTotal: 1.2e15 + (w.baseRx * (t - startedAt)) / 1000,
        txTotal: 1.8e14 + (w.baseTx * (t - startedAt)) / 1000,
        wanIp: w.ip,
        wanIpv6: w.ipv6,
        status: 'ok',
        latencyMs: Math.round(w.latency + 2 * envelope(t, 9 + i) + 1.5 * jitter(t, 80 + i, 6000)),
        monthRxBytes: month.reduce((s, d) => s + d.rxBytes, 0),
        monthTxBytes: month.reduce((s, d) => s + d.txBytes, 0),
        monthLabel,
        dayRxBytes: today?.rxBytes ?? 0,
        dayTxBytes: today?.txBytes ?? 0,
        dayLabel: today?.date ?? dayLabel(now),
        ispName: w.isp.name,
        ispOrg: w.isp.org,
        asn: w.isp.asn,
        availabilityPct: 99.5 + 0.5 * hash(i + Math.floor(t / 3_600_000)),
        uptimeSec: 1_500_000 + i * 100_000 + Math.floor((t - startedAt) / 1000),
        drops: Math.floor(hash(i * 3 + Math.floor(t / 600_000)) * 12),
        monitors: mockMonitors(w.latency, t, i),
      };
    });
  }

  function usageDaily(t: number): Record<string, DailyUsage[]> {
    const out: Record<string, DailyUsage[]> = {};
    const now = new Date(t);
    const dayFrac = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;
    WAN_FIXTURES.forEach((w, wi) => {
      const days: DailyUsage[] = [];
      for (let back = 30; back >= 0; back--) {
        const d = new Date(now);
        d.setDate(now.getDate() - back);
        const dayKey = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate();
        const weekend = d.getDay() === 0 || d.getDay() === 6;
        const scale = (0.55 + 0.9 * hash(dayKey * 7 + wi)) * (weekend ? 1.35 : 1);
        const frac = back === 0 ? dayFrac : 1;
        days.push({ date: dayLabel(d), rxBytes: w.dayRx * scale * frac, txBytes: w.dayTx * (0.6 + 0.8 * hash(dayKey * 11 + wi)) * frac });
      }
      out[w.id] = days;
    });
    return out;
  }

  function mockMonitors(latencyBase: number, t: number, i: number): HealthSubsystem['monitors'] {
    const j = (s: number) => 1 + 0.15 * jitter(t, s + i * 9, 10_000);
    return [
      { target: 'www.microsoft.com', type: 'icmp', latencyMs: Math.round((latencyBase + 5) * j(1)), availabilityPct: 100 },
      { target: 'google.com', type: 'icmp', latencyMs: Math.round((latencyBase + 3) * j(2)), availabilityPct: 100 },
      { target: '1.1.1.1', type: 'icmp', latencyMs: Math.round(latencyBase * j(3)), availabilityPct: 100 },
      { target: '1.1.1.1', type: 'dns', latencyMs: Math.round((latencyBase + 1) * j(4)), availabilityPct: 100 },
      { target: '8.8.8.8', type: 'dns', latencyMs: Math.round((latencyBase + 4) * j(5)), availabilityPct: 99.8 },
      { target: 'ping.ui.com', type: 'icmp', latencyMs: Math.round((latencyBase + 9) * j(6)), availabilityPct: 100 },
    ];
  }

  function health(current: Wan[], t: number): HealthSubsystem[] {
    const base: Omit<HealthSubsystem, 'name'> = {
      status: 'ok', latencyMs: null, drops: null, uptimeSec: null, xputDownMbps: null, xputUpMbps: null, speedtestLastRunTs: null,
      speedtestStatus: null, numUser: null, numGuest: null, wanIp: null, availabilityPct: null, monitors: [], ispName: null, ispOrg: null, asn: null,
    };
    const out: HealthSubsystem[] = current.map((w, i) => ({
      ...base, name: i === 0 ? 'wan' : `wan${i + 1}`, latencyMs: w.latencyMs, drops: w.drops, uptimeSec: w.uptimeSec, wanIp: w.wanIp,
      availabilityPct: w.availabilityPct, monitors: w.monitors, ispName: w.ispName, ispOrg: w.ispOrg, asn: w.asn,
    }));
    const wired = clients.filter((c) => c.isWired).length;
    out.push({ ...base, name: 'www', latencyMs: current[0]?.latencyMs ?? 6, drops: 0, uptimeSec: 1_500_000, xputDownMbps: 1172 + 20 * jitter(t, 300, 3_600_000), xputUpMbps: 123 + 4 * jitter(t, 301, 3_600_000), speedtestLastRunTs: Math.floor(t / 1000) - 7 * 3600 - 320, speedtestStatus: 'Idle' });
    out.push({ ...base, name: 'lan', numUser: wired, numGuest: 0 });
    out.push({ ...base, name: 'wlan', numUser: clients.length - wired - 1, numGuest: 1 });
    out.push({ ...base, name: 'vpn', numUser: 1 });
    return out;
  }

  function clientStats(t: number): ClientStat[] {
    return clients
      .filter((c) => !(c.isWired && switchOffline(c.attachedTo, t)))
      .map((c) => {
        const r = clientRates(c, t);
        const dev = devices.get(c.attachedTo)!;
        const ageSec = Math.floor(t / 1000) - c.firstSeen;
        return {
          id: `mock-c-${c.idx}`,
          name: c.name,
          ip: c.ip,
          mac: c.mac,
          rxBps: r.rx,
          txBps: r.tx,
          rxBytes: (CLASS_RATE[c.cls].rx * 0.4 * Math.min(ageSec, 86400 * 30)) + c.seed * 1e6,
          txBytes: (CLASS_RATE[c.cls].tx * 0.4 * Math.min(ageSec, 86400 * 30)) + c.seed * 4e5,
          isWired: c.isWired,
          isGuest: c.isGuest,
          signal: c.signal === null ? null : Math.round(c.signal + 2 * jitter(t, c.seed, 30_000)),
          vendor: c.vendor,
          device: c.device,
          firstSeen: c.firstSeen,
          lastSeen: Math.floor(t / 1000),
          network: c.isGuest ? 'Guest' : CLASS_NETWORK[c.cls],
          uplinkMac: dev.mac,
          swPort: c.swPort,
          band: c.band,
          channel: c.channel,
          essid: c.essid,
          rxRateMbps: c.rate,
          txRateMbps: c.rate,
          satisfaction: c.isWired ? 100 : clamp(100 + (c.signal ?? -50) + 40, 55, 100),
          uptimeSec: Math.min(ageSec, 86400 * 12 + c.seed),
        };
      });
  }

  function deviceList(t: number): NetworkDevice[] {
    computeRates(t);
    return [...devices.values()].map((d) => buildDevice(d, t));
  }

  function dpi(): { apps: DpiCategory[]; categories: DpiCategory[] } {
    const build = (fixtures: { name: string; weight: number }[], prefix: string, totalBytes: number) => {
      const totalWeight = fixtures.reduce((a, b) => a + b.weight, 0);
      return fixtures.map((d, i) => ({ id: `${prefix}-${i}`, name: d.name, bytes: (d.weight / totalWeight) * totalBytes, pct: d.weight / totalWeight }));
    };
    return { apps: build(DPI_APP_FIXTURES, 'mock-app', 357e9), categories: build(DPI_CATEGORY_FIXTURES, 'mock-cat', 378e9) };
  }

  function udmInfo(t: number): UdmInfo {
    const env = envelope(t, 2);
    return {
      name: `unifi.${DOMAIN}`,
      model: 'UDMPROMAX',
      modelName: modelName('UDMPROMAX'),
      firmware: '5.1.33',
      uptimeSec: 2_116_343 + Math.floor((t - startedAt) / 1000),
      cpuPct: clamp(5 + env * 9 + 2 * jitter(t, 400, 15_000), 1, 100),
      memPct: clamp(49.8 + 1.5 * jitter(t, 401, 60_000), 1, 100),
      tempC: 44.9 + env * 3 + 0.4 * jitter(t, 402, 15_000),
    };
  }

  /** ~900 VA unit on mains at a steady load; slow drift on load/voltage. */
  function ups(t: number): UpsInfo {
    const s = t / 1000;
    const slow = (period: number, amp: number, ph = 0) => Math.sin((s / period) * Math.PI * 2 + ph) * amp;
    const loadPct = clamp(48 + slow(90, 4) + slow(17, 1.5), 4, 95);
    const outputVoltage = 116 + slow(23, 1.4);
    const ratedW = 1500;
    const outputPowerW = Math.round((loadPct / 100) * ratedW);
    return {
      reachable: true,
      manufacturer: 'CyberPower',
      model: 'PR1500RTXL2UC',
      batteryStatus: 'normal',
      onBattery: false,
      secondsOnBattery: 0,
      minutesRemaining: Math.round(50 - loadPct * 0.25),
      chargePct: 100,
      batteryVoltage: 54.6 + slow(60, 0.2),
      batteryTempC: 25 + slow(300, 1.2),
      inputVoltage: Math.round(116 + slow(19, 1.8)),
      inputFrequencyHz: 60 + slow(40, 0.03),
      outputSource: 'normal',
      outputVoltage: Math.round(outputVoltage),
      outputFrequencyHz: 60 + slow(40, 0.03),
      outputCurrentA: Math.round((outputPowerW / outputVoltage) * 10) / 10,
      outputPowerW,
      loadPct: Math.round(loadPct),
    };
  }

  /** A plausible recent history so the events panel isn't empty on first run. */
  function seedEvents(record: (e: { severity: EventSeverity; kind: string; subject: string; message: string; ts: number }) => void): void {
    const now = Date.now();
    const h = 3_600_000;
    record({ ts: now - 2 * 24 * h - 4 * 60_000, severity: 'crit', kind: 'ups.battery', subject: 'UPS', message: 'UPS transferred to battery — mains power lost' });
    record({ ts: now - 2 * 24 * h, severity: 'info', kind: 'ups.mains', subject: 'UPS', message: 'UPS back on mains power' });
    record({ ts: now - 26 * h, severity: 'info', kind: 'device.firmware', subject: `core.${DOMAIN}`, message: `core.${DOMAIN} updated to 7.2.26` });
    record({ ts: now - 9 * h, severity: 'info', kind: 'wan.ip', subject: 'Xfinity', message: 'Xfinity public IP changed to 198.51.100.7' });
    record({ ts: now - 3 * h - 140_000, severity: 'warn', kind: 'device.offline', subject: `living-ap.${DOMAIN}`, message: `living-ap.${DOMAIN} lost contact` });
    record({ ts: now - 3 * h, severity: 'info', kind: 'device.online', subject: `living-ap.${DOMAIN}`, message: `living-ap.${DOMAIN} is back online` });
  }

  return { wans, usageDaily, health, clients: clientStats, devices: deviceList, dpi, udm: udmInfo, ups, seedEvents };
}
