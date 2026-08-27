import type {
  ClientStat,
  DpiCategory,
  HealthSubsystem,
  NetworkDevice,
  UdmInfo,
  UpsInfo,
  Wan,
} from './types.js';

const CLIENT_FIXTURES = [
  { name: 'tv-livingroom', isWired: true, baseDown: 35_000_000, baseUp: 800_000 },
  { name: 'mbp-matt', isWired: false, baseDown: 8_000_000, baseUp: 2_500_000 },
  { name: 'iphone-matt', isWired: false, baseDown: 1_200_000, baseUp: 200_000 },
  { name: 'ps5-basement', isWired: true, baseDown: 18_000_000, baseUp: 1_400_000, vendor: 'Sony Interactive Entertainment', device: 'PlayStation 5' },
  { name: 'nest-thermostat', isWired: false, baseDown: 4_000, baseUp: 2_000, vendor: 'Google, Inc.', device: 'Nest Thermostat' },
  { name: 'ipad-kitchen', isWired: false, baseDown: 6_000_000, baseUp: 400_000, vendor: 'Apple, Inc.', device: 'iPad' },
  { name: 'sonos-livingroom', isWired: false, baseDown: 1_800_000, baseUp: 80_000, vendor: 'Sonos, Inc.', device: 'Sonos Speaker' },
  { name: 'macbook-work', isWired: true, baseDown: 12_000_000, baseUp: 4_000_000, vendor: 'Apple, Inc.', device: 'MacBook Pro' },
  { name: 'nas-storage', isWired: true, baseDown: 200_000, baseUp: 5_000_000, vendor: 'Synology Inc.', device: 'NAS' },
  { name: 'unifi-camera-front', isWired: true, baseDown: 80_000, baseUp: 1_200_000, vendor: 'Ubiquiti Inc.', device: 'UniFi Protect Camera' },
  { name: 'unifi-camera-back', isWired: true, baseDown: 80_000, baseUp: 1_100_000, vendor: 'Ubiquiti Inc.', device: 'UniFi Protect Camera' },
  { name: 'roku-bedroom', isWired: false, baseDown: 9_000_000, baseUp: 100_000, vendor: 'Roku, Inc.', device: 'Roku Streaming Stick' },
  { name: 'switch-lite', isWired: false, baseDown: 800_000, baseUp: 60_000, vendor: 'Nintendo Co., Ltd.', device: 'Nintendo Switch Lite' },
  { name: 'ring-doorbell', isWired: false, baseDown: 40_000, baseUp: 380_000, vendor: 'Amazon Technologies Inc.', device: 'Ring Doorbell' },
  { name: 'echo-kitchen', isWired: false, baseDown: 30_000, baseUp: 12_000, vendor: 'Amazon Technologies Inc.', device: 'Echo Dot' },
  { name: 'hue-bridge', isWired: true, baseDown: 8_000, baseUp: 4_000, vendor: 'Philips Lighting BV', device: 'Hue Bridge' },
  { name: 'pihole-pi', isWired: true, baseDown: 100_000, baseUp: 50_000, vendor: 'Raspberry Pi Foundation', device: 'Raspberry Pi' },
];

const DPI_CATEGORY_FIXTURES = [
  { name: 'Streaming', weight: 62 },
  { name: 'Web', weight: 14 },
  { name: 'Games', weight: 9 },
  { name: 'Social', weight: 6 },
  { name: 'Cloud', weight: 4 },
  { name: 'Conferencing', weight: 3 },
  { name: 'Update Tools', weight: 2 },
];

const DPI_APP_FIXTURES = [
  { name: 'YouTube', weight: 28 },
  { name: 'Netflix', weight: 22 },
  { name: 'iCloud', weight: 12 },
  { name: 'SSL/TLS', weight: 10 },
  { name: 'Zoom', weight: 7 },
  { name: 'Discord', weight: 5 },
  { name: 'Steam', weight: 4 },
  { name: 'GitHub', weight: 3 },
];

type WanState = {
  rxTotal: number;
  txTotal: number;
  monthRx: number;
  monthTx: number;
  phaseOffset: number;
  baseRx: number;
  baseTx: number;
  ifName: string;
  ip: string;
  ipv6: string | null;
};
const WANS: WanState[] = [
  {
    rxTotal: 1_200_000_000_000,
    txTotal: 180_000_000_000,
    monthRx: 1_420_000_000_000,
    monthTx: 95_000_000_000,
    phaseOffset: 0,
    baseRx: 60_000_000,
    baseTx: 4_000_000,
    ifName: 'eth9',
    ip: '203.0.113.42',
    ipv6: '2600:1700:5451:1cf0::1/64',
  },
  {
    rxTotal: 600_000_000_000,
    txTotal: 80_000_000_000,
    monthRx: 280_000_000_000,
    monthTx: 18_000_000_000,
    phaseOffset: 3.7,
    baseRx: 28_000_000,
    baseTx: 2_000_000,
    ifName: 'eth10',
    ip: '198.51.100.7',
    ipv6: null,
  },
];

function currentMonthLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
let phase = 0;

function noise(amp: number): number {
  return (Math.random() - 0.5) * amp;
}

function envelope(t: number): number {
  return 0.65 + 0.25 * Math.sin(t / 9.7) + 0.15 * Math.sin(t / 3.3 + 1.1) + 0.1 * Math.sin(t / 1.7);
}

export function mockWans(intervalMs = 2000): Wan[] {
  phase += intervalMs / 1000;
  return WANS.map((w, i) => {
    const env = envelope(phase + w.phaseOffset);
    const rx = Math.max(0, w.baseRx * env + noise(w.baseRx * 0.25));
    const tx = Math.max(0, w.baseTx * env + noise(w.baseTx * 0.25));
    w.rxTotal += (rx * intervalMs) / 1000;
    w.txTotal += (tx * intervalMs) / 1000;
    w.monthRx += (rx * intervalMs) / 1000;
    w.monthTx += (tx * intervalMs) / 1000;
    return {
      id: `wan${i + 1}`,
      ifIndex: i + 3,
      ifName: w.ifName,
      label: i === 0 ? 'ATT Fiber' : 'Xfinity',
      speedBitsPerSec: i === 0 ? 10_000_000_000 : 2_500_000_000,
      rxBps: rx,
      txBps: tx,
      rxTotal: w.rxTotal,
      txTotal: w.txTotal,
      wanIp: w.ip,
      wanIpv6: w.ipv6,
      status: 'ok',
      latencyMs: 6 + Math.random() * 6 + i * 4,
      monthRxBytes: w.monthRx,
      monthTxBytes: w.monthTx,
      monthLabel: currentMonthLabel(),
    };
  });
}

const ISP_FIXTURES = [
  { name: 'AT&T Internet', org: 'AT&T Enterprises, LLC', asn: 7018 },
  { name: 'Xfinity / Comcast', org: 'Comcast Cable Communications, LLC', asn: 7922 },
];

function mockMonitors(latencyBase: number): HealthSubsystem['monitors'] {
  return [
    { target: 'www.microsoft.com', type: 'icmp', latencyMs: Math.max(1, Math.round(latencyBase + 5 + noise(2))), availabilityPct: 100 },
    { target: 'google.com', type: 'icmp', latencyMs: Math.max(1, Math.round(latencyBase * 4 + noise(5))), availabilityPct: 100 },
    { target: '1.1.1.1', type: 'icmp', latencyMs: Math.max(1, Math.round(latencyBase + noise(1))), availabilityPct: 100 },
    { target: '1.1.1.1', type: 'dns', latencyMs: Math.max(1, Math.round(latencyBase + 1 + noise(1))), availabilityPct: 100 },
    { target: '8.8.8.8', type: 'dns', latencyMs: Math.max(1, Math.round(latencyBase * 6 + noise(3))), availabilityPct: 100 },
    { target: 'ping.ui.com', type: 'icmp', latencyMs: Math.max(1, Math.round(latencyBase + noise(1))), availabilityPct: 100 },
  ];
}

export function mockHealth(wans: Wan[]): HealthSubsystem[] {
  const out: HealthSubsystem[] = [];
  for (let i = 0; i < wans.length; i++) {
    const w = wans[i]!;
    const isp = ISP_FIXTURES[i] ?? null;
    const latencyBase = (w.latencyMs ?? 8) / 1.4;
    out.push({
      name: i === 0 ? 'wan' : `wan${i + 1}`,
      status: 'ok',
      latencyMs: w.latencyMs ?? 8,
      drops: Math.floor(Math.abs(noise(20))),
      uptimeSec: 1_500_000 + i * 100_000,
      xputDownMbps: null,
      xputUpMbps: null,
      speedtestLastRunTs: null,
      speedtestStatus: null,
      numUser: null,
      numGuest: null,
      wanIp: w.wanIp,
      availabilityPct: 99.5 + Math.random() * 0.5,
      monitors: mockMonitors(latencyBase),
      ispName: isp?.name ?? null,
      ispOrg: isp?.org ?? null,
      asn: isp?.asn ?? null,
    });
  }
  const baseHealth: Omit<HealthSubsystem, 'name'> = {
    status: 'ok',
    latencyMs: null,
    drops: null,
    uptimeSec: null,
    xputDownMbps: null,
    xputUpMbps: null,
    speedtestLastRunTs: null,
    speedtestStatus: null,
    numUser: null,
    numGuest: null,
    wanIp: null,
    availabilityPct: null,
    monitors: [],
    ispName: null,
    ispOrg: null,
    asn: null,
  };
  out.push({
    ...baseHealth,
    name: 'www',
    latencyMs: 8 + noise(2),
    drops: 0,
    uptimeSec: 1_500_000,
    xputDownMbps: 940 + noise(20),
    xputUpMbps: 880 + noise(20),
    speedtestLastRunTs: Math.floor(Date.now() / 1000) - 6 * 3600,
    speedtestStatus: 'Idle',
  });
  out.push({ ...baseHealth, name: 'lan', numUser: 32, numGuest: 0 });
  out.push({ ...baseHealth, name: 'wlan', numUser: 47, numGuest: 3 });
  out.push({ ...baseHealth, name: 'vpn', numUser: 1 });
  return out;
}

export function mockClients(): ClientStat[] {
  const env = envelope(phase);
  return CLIENT_FIXTURES.map((c, i) => {
    const jitter = 0.7 + Math.random() * 0.6;
    const rxBps = c.baseDown * env * jitter;
    const txBps = c.baseUp * env * jitter;
    return {
      id: `mock-${i}`,
      name: c.name,
      ip: `192.168.1.${20 + i}`,
      mac: `aa:bb:cc:${i.toString(16).padStart(2, '0')}:00:00`,
      rxBps,
      txBps,
      rxBytes: 1_000_000_000 + i * 50_000_000 + Math.floor(rxBps * phase),
      txBytes: 100_000_000 + i * 5_000_000 + Math.floor(txBps * phase),
      isWired: c.isWired,
      signal: c.isWired ? null : -45 - Math.floor(Math.random() * 30),
      vendor: c.vendor ?? null,
      device: c.device ?? null,
      firstSeen: Math.floor(Date.now() / 1000) - 86400 - i * 3600,
      lastSeen: Math.floor(Date.now() / 1000),
    };
  });
}

export function mockDpi(): { apps: DpiCategory[]; categories: DpiCategory[] } {
  const build = (fixtures: { name: string; weight: number }[], prefix: string) => {
    const totalWeight = fixtures.reduce((a, b) => a + b.weight, 0);
    return fixtures.map((d, i) => ({
      id: `${prefix}-${i}`,
      name: d.name,
      bytes: d.weight * 100_000_000_000,
      pct: d.weight / totalWeight,
    }));
  };
  return {
    apps: build(DPI_APP_FIXTURES, 'mock-app'),
    categories: build(DPI_CATEGORY_FIXTURES, 'mock-cat'),
  };
}

export function mockUdm(): UdmInfo {
  const env = envelope(phase);
  return {
    name: 'UDM Pro Max',
    model: 'UDM-Pro-Max',
    firmware: '4.1.13',
    uptimeSec: 1_234_567 + Math.floor(phase),
    cpuPct: 12 + env * 25 + noise(3),
    memPct: 38 + noise(4),
    tempC: 52 + env * 4 + noise(1),
  };
}

// Mock topology. UDM is the root; AGG_SWITCH_INDEX is the one switch
// that uplinks directly to the UDM, every other switch uplinks to it.
// APs uplink to the switch named in their `uplinkSwitch` field.
const UDM_MAC = 'bb:aa:cc:00:00:00';
const UDM_NAME = 'udm.808.org';
const SWITCH_MAC = (i: number): string => `aa:bb:cc:ee:00:${i.toString(16).padStart(2, '0')}`;
const AP_MAC = (i: number): string => `aa:bb:cc:dd:00:${i.toString(16).padStart(2, '0')}`;
const AGG_SWITCH_INDEX = 1; // rack-sw-1

const AP_FIXTURES = [
  { name: 'garage-ap.808.org', model: 'U7PRO', clients: 5, ch24: 6, ch5: 100, ch6: 49, uplinkSwIdx: 3 },
  { name: 'dining-ap.808.org', model: 'U7PRO', clients: 14, ch24: 1, ch5: 36, ch6: 1, uplinkSwIdx: 5 },
  { name: 'living-ap.808.org', model: 'U7PRO', clients: 11, ch24: 11, ch5: 149, ch6: 17, uplinkSwIdx: 4 },
  { name: 'mainbed-ap.808.org', model: 'U7PRO', clients: 6, ch24: 6, ch5: 44, ch6: 33, uplinkSwIdx: 7 },
  { name: 'bnlroom-ap.808.org', model: 'U7PRO', clients: 8, ch24: 1, ch5: 64, ch6: 65, uplinkSwIdx: 7 },
  { name: 'backyard-ap.808.org', model: 'UKPW', clients: 3, ch24: 6, ch5: 36, ch6: 0, uplinkSwIdx: 3 },
];

// Each switch uplinks to AGG_SWITCH_INDEX, except the agg itself which
// uplinks to the UDM.
const SWITCH_FIXTURES = [
  { name: 'desksw.808.org', model: 'USPM16P', portsActive: 12, portsTotal: 18, poeWatts: 32 },
  { name: 'rack-sw-1.808.org', model: 'USXG24', portsActive: 18, portsTotal: 24, poeWatts: 0 },
  { name: 'rack-sw-2.808.org', model: 'USL24P', portsActive: 8, portsTotal: 24, poeWatts: 96 },
  { name: 'garage-sw.808.org', model: 'USL16P', portsActive: 5, portsTotal: 16, poeWatts: 18 },
  { name: 'living-sw.808.org', model: 'USL8P', portsActive: 4, portsTotal: 8, poeWatts: 14 },
  { name: 'kitchen-sw.808.org', model: 'USL8P', portsActive: 3, portsTotal: 8, poeWatts: 0 },
  { name: 'office-sw.808.org', model: 'USL8P', portsActive: 6, portsTotal: 8, poeWatts: 22 },
  { name: 'bnlroom-sw.808.org', model: 'USL8P', portsActive: 2, portsTotal: 8, poeWatts: 7 },
];

export function mockDevices(): NetworkDevice[] {
  const env = envelope(phase);
  const aps: NetworkDevice[] = AP_FIXTURES.map((a, i) => ({
    id: `mock-ap-${i}`,
    type: 'uap',
    name: a.name,
    model: a.model,
    ip: `192.168.1.${10 + i}`,
    mac: AP_MAC(i),
    state: 1,
    uptimeSec: 1_000_000 + i * 100_000,
    numClients: a.clients,
    bytesRate: a.clients * 800_000 * env + noise(50_000),
    rxBytes: 20_000_000_000 + i * 1_000_000_000,
    txBytes: 4_000_000_000 + i * 200_000_000,
    satisfaction: 90 + Math.floor(noise(8)),
    cpuPct: 8 + env * 12 + noise(3),
    memPct: 25 + noise(5),
    tempC: null,
    ports: [],
    radios: [
      { name: 'ng', band: '2g', channel: a.ch24, bwMhz: 20, numClients: Math.floor(a.clients * 0.2), utilizationPct: 18 + noise(8), satisfaction: 95, txRetries: 1000 + Math.floor(noise(500)), txPackets: 100_000 },
      { name: 'na', band: '5g', channel: a.ch5, bwMhz: 80, numClients: Math.floor(a.clients * 0.5), utilizationPct: 32 + noise(15), satisfaction: 92, txRetries: 5000 + Math.floor(noise(2000)), txPackets: 500_000 },
      ...(a.ch6
        ? ([
            { name: '6e', band: '6g' as const, channel: a.ch6, bwMhz: 160, numClients: Math.floor(a.clients * 0.3), utilizationPct: 12 + noise(6), satisfaction: 98, txRetries: 200 + Math.floor(noise(100)), txPackets: 200_000 },
          ])
        : []),
    ],
    uplink: {
      chassisId: SWITCH_MAC(a.uplinkSwIdx),
      portId: `Port ${i + 2}`,
      systemName: SWITCH_FIXTURES[a.uplinkSwIdx]?.name ?? null,
    },
  }));
  const sws: NetworkDevice[] = SWITCH_FIXTURES.map((s, i) => {
    const isAgg = i === AGG_SWITCH_INDEX;
    const upstreamMac = isAgg ? UDM_MAC : SWITCH_MAC(AGG_SWITCH_INDEX);
    const upstreamName = isAgg ? UDM_NAME : SWITCH_FIXTURES[AGG_SWITCH_INDEX]!.name;
    // Heavier uplink throughput than other ports — this is what the
    // topology page should highlight.
    const uplinkRx = (isAgg ? 80_000_000 : 12_000_000) * env + noise(2_000_000);
    const uplinkTx = (isAgg ? 80_000_000 : 12_000_000) * env + noise(2_000_000);
    return {
      id: `mock-sw-${i}`,
      type: 'usw',
      name: s.name,
      model: s.model,
      ip: `192.168.1.${30 + i}`,
      mac: SWITCH_MAC(i),
      state: 1,
      uptimeSec: 2_000_000 + i * 100_000,
      numClients: s.portsActive,
      bytesRate: s.portsActive * 400_000 * env + noise(100_000),
      rxBytes: 50_000_000_000 + i * 5_000_000_000,
      txBytes: 50_000_000_000 + i * 5_000_000_000,
      satisfaction: 95 + Math.floor(noise(5)),
      cpuPct: 5 + env * 8 + noise(2),
      memPct: 20 + noise(4),
      tempC: 42 + env * 4 + noise(2),
      ports: Array.from({ length: s.portsTotal }, (_, p) => ({
        idx: p + 1,
        name: `Port ${p + 1}`,
        up: p < s.portsActive,
        speedMbps: p < s.portsActive ? (p === 0 ? 10000 : 1000) : 0,
        isUplink: p === 0,
        poeWatts: p < s.portsActive && s.poeWatts > 0 ? s.poeWatts / s.portsActive : 0,
        rxBps: p === 0 ? Math.max(0, uplinkRx) : p < s.portsActive ? 200_000 + noise(100_000) : 0,
        txBps: p === 0 ? Math.max(0, uplinkTx) : p < s.portsActive ? 200_000 + noise(100_000) : 0,
        neighbor:
          p === 0
            ? { chassisId: upstreamMac, portId: null, systemName: upstreamName }
            : null,
      })),
      radios: [],
      uplink: null,
    };
  });
  // UDM as a device so the topology page can render it as a node. WAN
  // ports sit on the UDM; the LAN port that uplinks to the agg switch
  // doesn't get a neighbor here because the agg switch already reports
  // the link back from its side (deduped in the topology builder).
  const udm: NetworkDevice = {
    id: 'mock-udm',
    type: 'udm',
    name: UDM_NAME,
    model: 'UDM-Pro-Max',
    ip: '192.168.1.1',
    mac: UDM_MAC,
    state: 1,
    uptimeSec: 1_234_567 + Math.floor(phase),
    numClients: 0,
    bytesRate: 0,
    rxBytes: 0,
    txBytes: 0,
    satisfaction: 100,
    cpuPct: 12 + env * 25 + noise(3),
    memPct: 38 + noise(4),
    tempC: 52 + env * 4 + noise(1),
    ports: [],
    radios: [],
    uplink: null,
  };
  return [udm, ...aps, ...sws];
}

/** Synthetic UPS telemetry so the power page is exercisable without a real
 *  UPS. Models a ~900 VA unit on mains at a steady load, with slow noise on
 *  load/voltage and a full battery. Roughly what an APC SMT-class unit
 *  reports over RFC 1628. */
export function mockUps(): UpsInfo {
  const t = Date.now() / 1000;
  const slow = (period: number, amp: number, ph = 0) => Math.sin((t / period) * Math.PI * 2 + ph) * amp;
  const loadPct = Math.max(4, Math.min(95, 34 + slow(90, 6) + slow(17, 2)));
  const outputVoltage = 120 + slow(23, 1.4);
  const ratedW = 1500;
  const outputPowerW = Math.round((loadPct / 100) * ratedW);
  const outputCurrentA = outputPowerW / outputVoltage;
  return {
    reachable: true,
    manufacturer: 'CyberPower',
    model: 'PR1500RTXL2UC',
    batteryStatus: 'normal',
    onBattery: false,
    secondsOnBattery: 0,
    minutesRemaining: Math.round(41 - loadPct * 0.25),
    chargePct: 100,
    batteryVoltage: 56.8 + slow(60, 0.2),
    batteryTempC: 26 + slow(300, 1.2),
    inputVoltage: Math.round(120 + slow(19, 1.8)),
    inputFrequencyHz: 60 + slow(40, 0.03),
    outputSource: 'normal',
    outputVoltage: Math.round(outputVoltage),
    outputFrequencyHz: 60 + slow(40, 0.03),
    outputCurrentA: Math.round(outputCurrentA * 10) / 10,
    outputPowerW,
    loadPct: Math.round(loadPct),
  };
}
