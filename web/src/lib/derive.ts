import { buildTopology, type TopoEdge } from './topology.js';
import { bps, pct, shortName } from './format.js';
import type { Band, ClientStat, DeviceType, EnergyDay, NetworkDevice, PowerwallInfo, SpanInfo, UpsInfo, Wan, Features, EventSeverity } from './types.js';

/** Pure derivations over the snapshot: what needs attention, fleet rollups,
 *  link utilization. Kept out of the components so the thresholds live in one
 *  place and can be unit-tested without a DOM. */

// --- thresholds (all "greater than or equal" unless noted) ---
export const THRESHOLDS = {
  wanLatencyWarnMs: 80,
  wanLatencyCritMs: 200,
  wanAvailabilityWarnPct: 99,
  linkUtilWarn: 0.8,
  linkUtilCrit: 0.95,
  radioUtilWarnPct: 70,
  radioUtilCritPct: 90,
  // UniFi's per-interval retry ratio sits at 5–30% on healthy radios in a
  // busy RF neighborhood (measured on the live site), so only flag the
  // clearly pathological case.
  radioRetryWarnPct: 40,
  // Bands whose airtime/retry figures raise alerts. 2.4 GHz is left out on
  // purpose: it carries the IoT network and shares the air with hundreds of
  // neighboring APs, so high utilization there is the normal condition. Its
  // meters still show on the Wireless page.
  radioAlertBands: ['5g', '6g'] as readonly Band[],
  deviceCpuWarnPct: 85,
  deviceTempWarnC: 75,
  gatewayCpuWarnPct: 85,
  gatewayMemWarnPct: 90,
  gatewayTempWarnC: 80,
  poeBudgetWarn: 0.9,
  upsLoadWarnPct: 80,
  upsChargeWarnPct: 50,
  upsChargeCritPct: 20,
  satisfactionWarn: 70,
  // Powerwall charge (app-scaled %). The gateway keeps its own backup
  // reserve, so these flag "the reserve is close", not "empty".
  powerwallChargeWarnPct: 25,
  powerwallChargeCritPct: 12,
  // No fresh gateway reading for this long reads as stale on the kiosk.
  powerwallStaleMs: 60_000,
} as const;

export type Alert = {
  id: string;
  severity: EventSeverity;
  /** Short subject shown bold: a device, a WAN, "UPS". */
  subject: string;
  /** What is wrong, one clause. */
  detail: string;
  /** Page id where the detail lives (for the strip to hint at). */
  page: string;
};

export type AlertInput = {
  wans: Wan[];
  devices: NetworkDevice[];
  clients: ClientStat[];
  ups: UpsInfo | null;
  udm: { cpuPct: number; memPct: number; tempC: number | null } | null;
  features: Features;
  connection: 'connecting' | 'open' | 'closed' | 'error';
};

const severityRank: Record<EventSeverity, number> = { crit: 0, warn: 1, info: 2 };

export function deriveAlerts(s: AlertInput): Alert[] {
  const out: Alert[] = [];
  const add = (severity: EventSeverity, subject: string, detail: string, page: string) =>
    out.push({ id: `${page}:${subject}:${detail}`, severity, subject, detail, page });

  if (s.connection !== 'open') add('crit', 'Feed', 'dashboard disconnected from the panel server', 'overview');
  if (!s.features.controllerAvailable && s.connection === 'open') add('warn', 'UniFi', 'controller unreachable — device and client data is stale', 'overview');
  if (!s.features.snmpAvailable && s.connection === 'open') add('warn', 'SNMP', 'WAN telemetry unavailable', 'internet');

  for (const w of s.wans) {
    if (w.status === 'down') add('crit', w.label, 'down', 'internet');
    else if (w.status === 'degraded') add('warn', w.label, 'degraded', 'internet');
    if (w.latencyMs != null) {
      if (w.latencyMs >= THRESHOLDS.wanLatencyCritMs) add('crit', w.label, `latency ${w.latencyMs} ms`, 'internet');
      else if (w.latencyMs >= THRESHOLDS.wanLatencyWarnMs) add('warn', w.label, `latency ${w.latencyMs} ms`, 'internet');
    }
    if (w.availabilityPct != null && w.availabilityPct < THRESHOLDS.wanAvailabilityWarnPct) {
      add('warn', w.label, `availability ${pct(w.availabilityPct, 1)}`, 'internet');
    }
  }

  if (s.udm) {
    if (s.udm.cpuPct >= THRESHOLDS.gatewayCpuWarnPct) add('warn', 'Gateway', `CPU ${pct(s.udm.cpuPct)}`, 'overview');
    if (s.udm.memPct >= THRESHOLDS.gatewayMemWarnPct) add('warn', 'Gateway', `memory ${pct(s.udm.memPct)}`, 'overview');
    if (s.udm.tempC != null && s.udm.tempC >= THRESHOLDS.gatewayTempWarnC) add('warn', 'Gateway', `${s.udm.tempC.toFixed(0)}°C`, 'overview');
  }

  for (const d of s.devices) {
    if (d.type === 'uci') continue;
    const name = shortName(d.name);
    const page = d.type === 'uap' ? 'wireless' : 'wired';
    if (d.state !== 1) {
      add(d.type === 'uap' ? 'warn' : 'crit', name, deviceStateLabel(d.state).toLowerCase(), page);
      continue;
    }
    if (d.cpuPct != null && d.cpuPct >= THRESHOLDS.deviceCpuWarnPct) add('warn', name, `CPU ${pct(d.cpuPct)}`, page);
    if (d.tempC != null && d.tempC >= THRESHOLDS.deviceTempWarnC) add('warn', name, `${d.tempC.toFixed(0)}°C`, page);
    if (d.overheating) add('crit', name, 'overheating', page);
    if (d.poeBudgetW) {
      const draw = poeDraw(d);
      if (draw / d.poeBudgetW >= THRESHOLDS.poeBudgetWarn) add('warn', name, `PoE ${draw.toFixed(0)} / ${d.poeBudgetW} W`, 'wired');
    }
    for (const r of d.radios) {
      if (!THRESHOLDS.radioAlertBands.includes(r.band)) continue;
      const label = `${bandLabel(r.band)} ch ${r.channel}`;
      if (r.utilizationPct >= THRESHOLDS.radioUtilCritPct) add('crit', name, `${label} utilization ${pct(r.utilizationPct)}`, 'wireless');
      else if (r.utilizationPct >= THRESHOLDS.radioUtilWarnPct) add('warn', name, `${label} utilization ${pct(r.utilizationPct)}`, 'wireless');
      const retry = retryPct(r.txRetries, r.txPackets);
      if (retry >= THRESHOLDS.radioRetryWarnPct) add('warn', name, `${label} retries ${pct(retry, 1)}`, 'wireless');
    }
  }

  for (const l of deriveLinks(s.devices, s.wans)) {
    if (l.capacityBps <= 0) continue;
    if (l.utilization >= THRESHOLDS.linkUtilCrit) add('crit', l.label, `link ${pct(l.utilization * 100)} of ${bps(l.capacityBps / 8)}`, 'wired');
    else if (l.utilization >= THRESHOLDS.linkUtilWarn) add('warn', l.label, `link ${pct(l.utilization * 100)} of ${bps(l.capacityBps / 8)}`, 'wired');
  }

  if (s.features.upsAvailable) upsAlerts(s.ups, add);

  return finalizeAlerts(out);
}

type AddAlert = (severity: EventSeverity, subject: string, detail: string, page: string) => void;

function upsAlerts(u: UpsInfo | null, add: AddAlert): void {
  if (!u || !u.reachable) add('warn', 'UPS', 'not answering SNMP', 'power');
  else {
    if (u.onBattery) add('crit', 'UPS', `on battery${u.minutesRemaining != null ? ` — ${u.minutesRemaining} min left` : ''}`, 'power');
    if (u.batteryStatus === 'low' || u.batteryStatus === 'depleted') add('crit', 'UPS', `battery ${u.batteryStatus}`, 'power');
    if (u.chargePct != null && u.chargePct < THRESHOLDS.upsChargeCritPct) add('crit', 'UPS', `charge ${pct(u.chargePct)}`, 'power');
    else if (u.chargePct != null && u.chargePct < THRESHOLDS.upsChargeWarnPct) add('warn', 'UPS', `charge ${pct(u.chargePct)}`, 'power');
    if (u.loadPct != null && u.loadPct >= THRESHOLDS.upsLoadWarnPct) add('warn', 'UPS', `load ${pct(u.loadPct)}`, 'power');
  }
}

/** Dedupe (same subject+detail can arise twice from both link ends) and
 *  order critical first. */
function finalizeAlerts(out: Alert[]): Alert[] {
  const seen = new Set<string>();
  return out
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.subject.localeCompare(b.subject));
}

export type EnergyAlertInput = {
  powerwall: PowerwallInfo | null;
  span?: SpanInfo | null;
  ups: UpsInfo | null;
  features: Features;
  connection: string;
  now: number;
};

/** What needs attention on the energy kiosk: grid outage, Powerwall
 *  reachability/staleness/charge, and the rack UPS. */
export function deriveEnergyAlerts(s: EnergyAlertInput): Alert[] {
  const out: Alert[] = [];
  const add: AddAlert = (severity, subject, detail, page) => out.push({ id: `${page}:${subject}:${detail}`, severity, subject, detail, page });

  if (s.connection !== 'open') add('crit', 'Feed', 'dashboard disconnected from the panel server', 'energy');
  if (s.features.powerwallAvailable && s.connection === 'open') {
    const p = s.powerwall;
    if (!p || !p.reachable) add('warn', 'Powerwall', 'gateway not answering', 'energy');
    else {
      if (s.now - p.updatedAt > THRESHOLDS.powerwallStaleMs) add('warn', 'Powerwall', 'readings are stale', 'energy');
      if (p.grid === 'islanded') add('crit', 'Grid', 'outage — home running on Powerwall', 'energy');
      if (p.chargePct != null && p.chargePct < THRESHOLDS.powerwallChargeCritPct) add('crit', 'Powerwall', `charge ${pct(p.chargePct)}`, 'energy');
      else if (p.chargePct != null && p.chargePct < THRESHOLDS.powerwallChargeWarnPct) add('warn', 'Powerwall', `charge ${pct(p.chargePct)}`, 'energy');
    }
  }
  if (s.features.spanAvailable && s.connection === 'open') {
    if (!s.span || !s.span.reachable) add('warn', 'SPAN', 'panel not publishing', 'circuits');
    else for (const c of s.span.circuits) if (c.relay === 'OPEN') add('warn', c.name, 'circuit switched off', 'circuits');
  }
  if (s.features.upsAvailable) upsAlerts(s.ups, add);
  return finalizeAlerts(out);
}

// --- whole-home power flow (sources → panel → circuits) ---

export type FlowNode = { key: string; label: string; watts: number; color: string; detail?: string };
export type Flow = { sources: FlowNode[]; sinks: FlowNode[]; inW: number; outW: number };

/** Below this a flow isn't drawn (meter noise, idle inverters). */
const FLOW_MIN_W = 15;

/** Where the home's power comes from and where it goes, for the Sankey.
 *  Sources and the grid/battery sinks come from the Powerwall (its four
 *  meters balance); the load side is broken out by SPAN circuit. Circuits
 *  that feed the panel (the Powerwall's backfeed breaker) are skipped so
 *  storage isn't counted twice, and any gap between the Powerwall's home
 *  total and the circuit sum is shown as "Unmetered" rather than hidden.
 *  Past `maxCircuits`, the smallest circuits fold into one "Other" sink. */
export function deriveFlow(pw: PowerwallInfo | null, span: SpanInfo | null, maxCircuits = 8): Flow | null {
  const gridW = pw?.gridW ?? span?.gridW ?? null;
  if (gridW == null) return null;
  const solar = pw?.solarW ?? 0;
  const battery = pw?.batteryW ?? 0;
  const sources: FlowNode[] = [
    { key: 'solar', label: 'Solar', watts: solar, color: 'var(--solar)' },
    { key: 'battery', label: 'Powerwall', watts: Math.max(0, battery), color: 'var(--battery)', detail: 'discharging' },
    { key: 'grid', label: 'Grid', watts: Math.max(0, gridW), color: 'var(--grid)', detail: 'importing' },
  ].filter((n) => n.watts >= FLOW_MIN_W);

  const sinks: FlowNode[] = [];
  const loads = (span?.reachable ? span.circuits : []).filter((c) => !c.source && c.powerW >= FLOW_MIN_W).sort((a, b) => b.powerW - a.powerW);
  const shown = loads.length > maxCircuits + 1 ? loads.slice(0, maxCircuits) : loads;
  const rest = loads.slice(shown.length);
  for (const c of shown) sinks.push({ key: `c:${c.id}`, label: c.name, watts: c.powerW, color: 'var(--home)' });
  if (rest.length) {
    sinks.push({ key: 'c:other', label: `${rest.length} other circuits`, watts: rest.reduce((a, c) => a + c.powerW, 0), color: 'var(--home)' });
  }
  const metered = loads.reduce((a, c) => a + c.powerW, 0);
  const home = pw?.homeW ?? (span?.reachable ? metered : 0);
  if (loads.length === 0 && home >= FLOW_MIN_W) sinks.push({ key: 'home', label: 'Home', watts: home, color: 'var(--home)' });
  else if (home - metered >= FLOW_MIN_W * 4) sinks.push({ key: 'unmetered', label: 'Unmetered', watts: home - metered, color: 'var(--ink-3)', detail: 'home total minus circuits' });
  if (battery <= -FLOW_MIN_W) sinks.push({ key: 'charge', label: 'Powerwall', watts: -battery, color: 'var(--battery)', detail: 'charging' });
  if (gridW <= -FLOW_MIN_W) sinks.push({ key: 'export', label: 'Grid', watts: -gridW, color: 'var(--grid)', detail: 'exporting' });

  return {
    sources,
    sinks,
    inW: sources.reduce((a, n) => a + n.watts, 0),
    outW: sinks.reduce((a, n) => a + n.watts, 0),
  };
}

/** Direction words for a signed flow, so the UI never relies on a sign or
 *  a color alone. */
export function gridDirection(w: number): 'importing' | 'exporting' | 'idle' {
  return Math.abs(w) < 20 ? 'idle' : w > 0 ? 'importing' : 'exporting';
}
export function batteryDirection(w: number): 'discharging' | 'charging' | 'idle' {
  return Math.abs(w) < 20 ? 'idle' : w > 0 ? 'discharging' : 'charging';
}

/** Share of the home's energy that didn't come from the grid (solar +
 *  battery), 0–100; null with no consumption. */
export function selfPoweredPct(day: EnergyDay | null): number | null {
  if (!day || day.homeWh <= 0) return null;
  return Math.max(0, Math.min(100, (1 - day.gridImportWh / day.homeWh) * 100));
}

export function gridLabel(g: PowerwallInfo['grid']): string {
  return g === 'connected' ? 'Grid connected' : g === 'islanded' ? 'Off grid' : g === 'transition' ? 'Switching' : 'Grid unknown';
}

export function deviceStateLabel(state: number): string {
  switch (state) {
    case 0:
      return 'Offline';
    case 1:
      return 'Online';
    case 2:
      return 'Pending adoption';
    case 4:
      return 'Upgrading';
    case 5:
      return 'Provisioning';
    case 6:
      return 'Heartbeat missed';
    case 7:
      return 'Adopting';
    case 9:
      return 'Adoption failed';
    case 10:
      return 'Isolated';
    default:
      return `State ${state}`;
  }
}

export function bandLabel(b: Band): string {
  return b === '2g' ? '2.4 GHz' : b === '5g' ? '5 GHz' : '6 GHz';
}

export function bandShort(b: Band): string {
  return b === '2g' ? '2.4' : b === '5g' ? '5' : '6';
}

export function retryPct(retries: number, packets: number): number {
  if (packets <= 0) return 0;
  return Math.min(100, (retries / packets) * 100);
}

export function poeDraw(d: NetworkDevice): number {
  return d.ports.reduce((s, p) => s + (p.poeWatts || 0), 0);
}

export function deviceTypeLabel(t: DeviceType): string {
  return t === 'udm' ? 'Gateway' : t === 'usw' ? 'Switch' : t === 'uap' ? 'Access point' : t === 'uci' ? 'Modem' : 'Device';
}

export type FleetSummary = {
  switches: { total: number; online: number };
  aps: { total: number; online: number };
  gatewayOnline: boolean;
  poeDrawW: number;
  poeBudgetW: number;
  portsUp: number;
  portsTotal: number;
  clients: { total: number; wired: number; wireless: number; guest: number };
  wirelessByBand: Record<Band, number>;
};

export function fleetSummary(devices: NetworkDevice[], clients: ClientStat[]): FleetSummary {
  const sw = devices.filter((d) => d.type === 'usw');
  const ap = devices.filter((d) => d.type === 'uap');
  const gw = devices.find((d) => d.type === 'udm');
  const wired = clients.filter((c) => c.isWired).length;
  const byBand: Record<Band, number> = { '2g': 0, '5g': 0, '6g': 0 };
  for (const c of clients) if (!c.isWired && c.band) byBand[c.band]++;
  // Radios know their client counts even when the client list can't be
  // associated to an AP; prefer that when it's populated.
  const radioTotal = ap.reduce((s, d) => s + d.radios.reduce((x, r) => x + r.numClients, 0), 0);
  if (radioTotal > 0 && byBand['2g'] + byBand['5g'] + byBand['6g'] === 0) {
    for (const d of ap) for (const r of d.radios) byBand[r.band] += r.numClients;
  }
  return {
    switches: { total: sw.length, online: sw.filter((d) => d.state === 1).length },
    aps: { total: ap.length, online: ap.filter((d) => d.state === 1).length },
    gatewayOnline: gw ? gw.state === 1 : true,
    poeDrawW: sw.reduce((s, d) => s + poeDraw(d), 0),
    poeBudgetW: sw.reduce((s, d) => s + (d.poeBudgetW ?? 0), 0),
    portsUp: sw.reduce((s, d) => s + d.ports.filter((p) => p.up).length, 0),
    portsTotal: sw.reduce((s, d) => s + d.ports.length, 0),
    clients: { total: clients.length, wired, wireless: clients.length - wired, guest: clients.filter((c) => c.isGuest).length },
    wirelessByBand: byBand,
  };
}

export type Link = TopoEdge & {
  /** "core ↔ agg" style label using short names. */
  label: string;
  sourceName: string;
  targetName: string;
};

/** Inter-device links (switch↔switch, switch↔AP, UDM↔switch) with current
 *  throughput and capacity, busiest first. WAN links are excluded — the
 *  internet page covers those. */
export function deriveLinks(devices: NetworkDevice[], wans: Wan[]): Link[] {
  const topo = buildTopology(devices, wans);
  const nameOf = new Map<string, string>();
  for (const n of topo.nodes) nameOf.set(n.id, n.kind === 'device' ? shortName(n.device.name) : n.wan.label);
  return topo.edges
    .filter((e) => !e.isWanLink)
    .map((e) => {
      const sourceName = nameOf.get(e.sourceId) ?? e.sourceId;
      const targetName = nameOf.get(e.targetId) ?? e.targetId;
      return { ...e, sourceName, targetName, label: `${targetName} → ${sourceName}` };
    })
    .sort((a, b) => b.rateBps - a.rateBps);
}

/** Map a device mac to its display name, for client → AP/switch labels. */
export function deviceNameByMac(devices: NetworkDevice[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of devices) if (d.mac) m.set(d.mac.toLowerCase(), shortName(d.name));
  return m;
}

/** Tone for a 0–100 utilization-style value. */
export function utilTone(v: number | null | undefined, warn = 75, crit = 90): 'ok' | 'warn' | 'crit' | 'none' {
  if (v == null || !Number.isFinite(v)) return 'none';
  if (v >= crit) return 'crit';
  if (v >= warn) return 'warn';
  return 'ok';
}

/** Tone for a WiFi signal in dBm. */
export function signalTone(dbm: number | null): 'ok' | 'warn' | 'crit' | 'none' {
  if (dbm == null) return 'none';
  if (dbm <= -75) return 'crit';
  if (dbm <= -67) return 'warn';
  return 'ok';
}

/** 0–4 bars for a WiFi signal. */
export function signalBars(dbm: number | null): number {
  if (dbm == null) return 0;
  if (dbm >= -55) return 4;
  if (dbm >= -65) return 3;
  if (dbm >= -72) return 2;
  if (dbm >= -80) return 1;
  return 0;
}
