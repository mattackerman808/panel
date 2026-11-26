import { buildTopology, type TopoEdge } from './topology.js';
import { bps, formatUptime, pct, shortName } from './format.js';
import type { Band, ClientStat, DeviceType, EnergyDay, MicroinverterInfo, NetworkDevice, PowerwallInfo, PowerwallSample, SpanCircuit, SpanInfo, UpsInfo, Wan, Features, EventSeverity } from './types.js';

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
  microinverters?: MicroinverterInfo[];
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
      if (p.grid === 'islanded') {
        const b = backupEstimate(s.span ?? null, p);
        const left = b?.forecastMin ?? b?.atCurrentMin ?? null;
        add('crit', 'Grid', `outage — home running on Powerwall${left != null ? `, ~${formatUptime(left * 60)} backup left` : ''}`, 'energy');
      }
      if (p.chargePct != null && p.chargePct < THRESHOLDS.powerwallChargeCritPct) add('crit', 'Powerwall', `charge ${pct(p.chargePct)}`, 'energy');
      else if (p.chargePct != null && p.chargePct < THRESHOLDS.powerwallChargeWarnPct) add('warn', 'Powerwall', `charge ${pct(p.chargePct)}`, 'energy');
    }
  }
  if (s.features.spanAvailable && s.connection === 'open') {
    if (!s.span || !s.span.reachable) add('warn', 'SPAN', 'panel not publishing', 'circuits');
    else for (const c of s.span.circuits) if (c.relay === 'OPEN') add('warn', c.name, 'circuit switched off', 'circuits');
  }
  // Inverter alarms only: an EZ1 going quiet is just sunset.
  for (const m of s.microinverters ?? []) {
    if (!m.reachable) continue;
    for (const a of m.alarms) add('warn', m.name, a, 'energy');
    if (m.outputOn === false) add('warn', m.name, 'output switched off', 'energy');
  }
  if (s.features.upsAvailable) upsAlerts(s.ups, add);
  return finalizeAlerts(out);
}

// --- backup runtime ---

export type BackupEstimate = {
  /** SPAN's forecast (accounts for load-shed tiers), minutes. */
  forecastMin: number | null;
  /** Plain arithmetic: stored energy over the live draw net of solar. Null
   *  when solar covers the load (no drain) or the stored energy is unknown. */
  atCurrentMin: number | null;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  /** Minutes to the next shed tier, only when circuits are set to shed. */
  nextShedMin: number | null;
  storedKWh: number | null;
};

/** How long the house could run off-grid: SPAN's forecast as the headline
 *  and a naive "at current draw" figure beside it — they differ because
 *  SPAN assumes a typical load, while an evening with the hot tub and EV
 *  charger running drains much faster. */
export function backupEstimate(span: SpanInfo | null, pw: PowerwallInfo | null): BackupEstimate | null {
  const b = span?.reachable ? span.backup : null;
  if (!b) return null;
  const drainW = pw ? Math.max(0, pw.homeW - pw.solarW) : null;
  const atCurrentMin = b.storedKWh != null && drainW != null && drainW >= 50 ? Math.round((b.storedKWh * 1000 * 60) / drainW) : null;
  return {
    forecastMin: b.totalMin != null && b.totalMin > 0 ? b.totalMin : null,
    atCurrentMin,
    confidence: b.confidence,
    nextShedMin: b.sheddableCircuits > 0 && b.nextShedMin != null && b.nextShedMin > 0 ? b.nextShedMin : null,
    storedKWh: b.storedKWh,
  };
}

// --- circuit flow (sources → panel → each circuit) ---

export type CircuitRow = {
  key: string;
  name: string;
  /** Live draw, W (consumption positive). */
  watts: number;
  todayWh: number | null;
  /** Breaker capacity in W (rating × 120 V × poles), when known. */
  capacityW: number | null;
  ratingA: number | null;
  kind: 'circuit' | 'other' | 'unmetered';
  /** Drawing enough to animate (and to not be dimmed). */
  active: boolean;
  off: boolean;
  /** Known split of this circuit's draw (e.g. the rack UPS's measured
   *  output vs the rest of an unmetered subpanel). Sums to `watts`. */
  parts?: Array<{ label: string; watts: number; measured: boolean }>;
};

export type UpsCircuit = { name: string; upsLabel: string; restLabel: string };

/** A circuit drawing less than this reads as idle (standby, meter noise). */
export const CIRCUIT_ACTIVE_W = 15;

const firstSpace = (spaces: string) => Number.parseInt(spaces.split(',')[0] ?? '', 10) || 999;

/** Rows for the circuit flow diagram, in breaker order so the layout stays
 *  put instead of reshuffling with every change in load. Circuits that
 *  feed the panel (the Powerwall's backfeed breaker) are left out — they
 *  are drawn as the Powerwall source. Past `maxRows`, the idlest circuits
 *  fold into one "other circuits" row. When the Powerwall's home total
 *  exceeds the circuit sum, the gap gets its own "Unmetered" row. */
export function circuitRows(
  span: SpanInfo | null,
  pw: PowerwallInfo | null,
  opts: { maxRows?: number; ups?: UpsInfo | null; upsCircuit?: UpsCircuit | null; plugInCircuit?: string | null } = {},
): CircuitRow[] {
  const maxRows = opts.maxRows ?? 14;
  if (!span) return [];
  const upsW = opts.ups?.reachable ? opts.ups.outputPowerW : null;
  const upsOn = opts.upsCircuit?.name.trim().toLowerCase() ?? null;
  // Plug-in solar feeds an outlet, so SPAN meters that circuit NET of it
  // (and the Powerwall's home figure already has it added back). With the
  // circuit named, give it its true draw; otherwise keep the output out of
  // the Unmetered gap — it is measured, just not by SPAN.
  const plugInW = pw?.plugInSolarW ?? 0;
  const plugOn = opts.plugInCircuit?.trim().toLowerCase() || null;
  const isPlugIn = (c: SpanCircuit) => plugOn != null && c.name.trim().toLowerCase() === plugOn;
  const draw = (c: SpanCircuit) => Math.max(0, c.powerW + (isPlugIn(c) ? plugInW : 0));
  // The plug-in circuit can backfeed enough to be classed as a source; it
  // is still a load.
  const loads = span.circuits.filter((c) => !c.source || isPlugIn(c));
  const plugInMatched = plugInW > 0 && loads.some(isPlugIn);
  let keep = loads;
  let folded: typeof loads = [];
  if (loads.length > maxRows) {
    const byDraw = loads.slice().sort((a, b) => draw(b) - draw(a));
    keep = byDraw.slice(0, maxRows - 1);
    folded = byDraw.slice(maxRows - 1);
  }
  const rows: CircuitRow[] = keep
    .slice()
    .sort((a, b) => firstSpace(a.spaces) - firstSpace(b.spaces))
    .map((c) => {
      const poles = c.spaces.split(',').filter(Boolean).length || 1;
      const watts = draw(c);
      return {
        key: c.id,
        name: c.name,
        watts,
        todayWh: c.todayWh,
        capacityW: c.ratingA ? c.ratingA * 120 * poles : null,
        ratingA: c.ratingA,
        kind: 'circuit',
        active: watts >= CIRCUIT_ACTIVE_W && c.relay !== 'OPEN',
        off: c.relay === 'OPEN',
        // The UPS reports its OUTPUT; its conversion loss lands in "rest".
        ...(upsOn && upsW != null && c.name.trim().toLowerCase() === upsOn
          ? {
              parts: [
                { label: opts.upsCircuit!.upsLabel, watts: Math.min(upsW, watts), measured: true },
                { label: opts.upsCircuit!.restLabel, watts: Math.max(0, watts - upsW), measured: false },
              ],
            }
          : {}),
        // When the plug-in feeds the UPS circuit too, the UPS split wins: it
        // is already computed on the corrected draw, so the outlets' real
        // load lands in its "rest" share.
        ...(isPlugIn(c) && plugInW > 0 && !(upsOn && upsW != null && c.name.trim().toLowerCase() === upsOn)
          ? {
              parts: [
                { label: 'From panel', watts: Math.max(0, c.powerW), measured: true },
                { label: 'From plug-in', watts: Math.min(plugInW, watts), measured: true },
              ],
            }
          : {}),
      };
    });
  if (folded.length) {
    const watts = folded.reduce((a, c) => a + draw(c), 0);
    const known = folded.filter((c) => c.todayWh != null);
    rows.push({
      key: 'other',
      name: `${folded.length} other circuits`,
      watts,
      todayWh: known.length ? known.reduce((a, c) => a + (c.todayWh ?? 0), 0) : null,
      capacityW: null,
      ratingA: null,
      kind: 'other',
      active: watts >= CIRCUIT_ACTIVE_W,
      off: false,
    });
  }
  const metered = loads.reduce((a, c) => a + draw(c), 0) + (plugInMatched ? 0 : plugInW);
  if (pw && pw.homeW - metered >= CIRCUIT_ACTIVE_W * 4) {
    rows.push({
      key: 'unmetered',
      name: 'Unmetered',
      watts: pw.homeW - metered,
      todayWh: null,
      capacityW: null,
      ratingA: null,
      kind: 'unmetered',
      active: true,
      off: false,
    });
  }
  return rows;
}

/** A power source feeding the SPAN panel in the circuit flow. `watts` is
 *  positive into the panel; export and Powerwall charging run negative. */
export type FlowSource = {
  key: 'solar' | 'plugin' | 'grid' | 'battery';
  label: string;
  watts: number;
  dir: string;
  color: string;
  idle: boolean;
  /** The grid while islanded. */
  off?: boolean;
};

/** Solar, grid and Powerwall as sources for the circuit flow (desktop
 *  diagram and phone list alike). Without the Powerwall gateway only the
 *  grid is known, from SPAN's main meter. */
export function flowSources(pw: PowerwallInfo | null, span: SpanInfo): FlowSource[] {
  const gridW = pw?.gridW ?? span.gridW ?? 0;
  const list: FlowSource[] = [];
  if (pw) {
    // With plug-in microinverters the roof (Tesla) and the plug-in system
    // are separate sources; solarW includes both.
    const plugIn = pw.plugInSolarW;
    const roof = plugIn != null ? Math.max(0, pw.solarW - plugIn) : pw.solarW;
    const label = plugIn != null ? 'Tesla solar' : 'Solar';
    list.push({ key: 'solar', label, watts: roof, dir: roof >= CIRCUIT_ACTIVE_W ? 'producing' : 'idle', color: 'var(--solar)', idle: roof < CIRCUIT_ACTIVE_W });
    if (plugIn != null) {
      list.push({ key: 'plugin', label: 'Plug-in solar', watts: plugIn, dir: plugIn >= CIRCUIT_ACTIVE_W ? 'producing' : 'idle', color: 'var(--solar)', idle: plugIn < CIRCUIT_ACTIVE_W });
    }
  }
  list.push({
    key: 'grid',
    label: 'Grid',
    watts: gridW,
    dir: pw?.grid === 'islanded' ? 'off grid' : gridDirection(gridW),
    color: 'var(--grid)',
    idle: Math.abs(gridW) < CIRCUIT_ACTIVE_W,
    off: pw?.grid === 'islanded',
  });
  if (pw) list.push({ key: 'battery', label: 'Powerwall', watts: pw.batteryW, dir: batteryDirection(pw.batteryW), color: 'var(--battery)', idle: Math.abs(pw.batteryW) < CIRCUIT_ACTIVE_W });
  return list;
}

// --- solar by system (Tesla roof vs plug-in microinverters) ---

export type SolarSystem = {
  key: 'roof' | 'plugin';
  label: string;
  /** Live output, W. */
  watts: number;
  /** Produced today, Wh (null: not known yet). */
  todayWh: number | null;
  /** Highest one-minute average since local midnight, W. */
  peakW: number | null;
  /** Share of today's total solar, 0–100. */
  sharePct: number | null;
  /** One-minute averages since local midnight, for a sparkline. */
  series: Array<number | null>;
};

/** Split solar into the Tesla (roof) system and the plug-in microinverters.
 *  Null when no microinverters are configured (solar is all roof then).
 *  Minutes recorded before the split was tracked count as roof-only. */
export function solarSystems(
  pw: PowerwallInfo | null,
  history: PowerwallSample[],
  today: EnergyDay | null,
  inverters: MicroinverterInfo[],
  now = Date.now(),
): SolarSystem[] | null {
  if (!pw || pw.plugInSolarW == null) return null;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const day = history.filter((s) => s.ts >= midnight.getTime());
  const plugSeries = day.map((s) => s.plugInSolarW ?? null);
  const roofSeries = day.map((s) => Math.max(0, s.solarW - (s.plugInSolarW ?? 0)));
  const peak = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? Math.max(...v) : null;
  };
  const fromInverters = inverters.some((m) => m.todayWh != null) ? inverters.reduce((a, m) => a + (m.todayWh ?? 0), 0) : null;
  const plugWh = today?.plugInSolarWh ?? fromInverters;
  const roofWh = today ? Math.max(0, today.solarWh - (plugWh ?? 0)) : null;
  const total = today?.solarWh ?? 0;
  const share = (wh: number | null) => (wh != null && total > 0 ? Math.min(100, (wh / total) * 100) : null);
  return [
    { key: 'roof', label: 'Tesla solar', watts: Math.max(0, pw.solarW - pw.plugInSolarW), todayWh: roofWh, peakW: peak(roofSeries), sharePct: share(roofWh), series: roofSeries },
    { key: 'plugin', label: 'Plug-in solar', watts: pw.plugInSolarW, todayWh: plugWh, peakW: peak(plugSeries), sharePct: share(plugWh), series: plugSeries },
  ];
}

/** Rank keys by value, largest first, with hysteresis: starting from the
 *  previous order, an item only climbs past its neighbour when it beats it
 *  by `ratio` and by `marginW` — so two loads trading places around the
 *  same draw don't swap on every reading, while a kettle switching on
 *  still jumps straight up. New keys enter at the bottom and climb; gone
 *  keys drop out. With no previous order it is a plain stable sort. */
export function stickyRank(
  prev: readonly string[],
  items: ReadonlyArray<{ key: string; watts: number }>,
  opts: { ratio?: number; marginW?: number } = {},
): string[] {
  const ratio = opts.ratio ?? 1.25;
  const margin = opts.marginW ?? 25;
  const w = new Map(items.map((i) => [i.key, i.watts]));
  if (prev.length === 0) return items.slice().sort((a, b) => b.watts - a.watts).map((i) => i.key);
  const order = prev.filter((k) => w.has(k));
  for (const i of items) if (!order.includes(i.key)) order.push(i.key);
  const beats = (a: string, b: string) => w.get(a)! > w.get(b)! * ratio + margin;
  for (let i = 1; i < order.length; i++) {
    for (let j = i; j > 0 && beats(order[j]!, order[j - 1]!); j--) [order[j - 1], order[j]] = [order[j]!, order[j - 1]!];
  }
  return order;
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
