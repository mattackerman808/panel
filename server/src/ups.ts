import { SnmpClient } from './snmp.js';
import type { UpsInfo } from './types.js';

/** UPS power monitoring over SNMP.
 *
 *  Primary source is the vendor-neutral UPS-MIB (RFC 1628, rooted at
 *  1.3.6.1.2.1.33), which most network-managed UPSes implement. Some units
 *  populate the standard MIB only partially — the CyberPower RMCARD, for
 *  instance, returns 0 for upsOutputPower/upsOutputCurrent and only reports
 *  real Watts/Amps in its enterprise MIB — so we also read the CyberPower
 *  (1.3.6.1.4.1.3808) and APC PowerNet (1.3.6.1.4.1.318) trees and coalesce.
 *
 *  Everything is fetched in a single SNMP GET: SNMPv2c reports missing
 *  objects per-varbind (noSuchInstance) instead of failing the whole
 *  request, and enterprise OIDs simply come back empty on a device from a
 *  different vendor, so requesting the union of all three MIBs is safe.
 *
 *  Scaling differs *between* MIBs for the same quantity (RFC 1628 reports
 *  line voltage in whole RMS volts; CyberPower in tenths of a volt), so each
 *  source is scaled to base units individually before the values are
 *  coalesced — never coalesce raw counts across MIBs.
 *
 *  Line-indexed tables (input/output) are read at line index 1, which is
 *  correct for the single-phase UPSes this dashboard targets. */

// --- RFC 1628 UPS-MIB (1.3.6.1.2.1.33.1.*) ---
const STD = {
  manufacturer: '1.3.6.1.2.1.33.1.1.1.0',
  model: '1.3.6.1.2.1.33.1.1.2.0',
  batteryStatus: '1.3.6.1.2.1.33.1.2.1.0', // 1 unknown, 2 normal, 3 low, 4 depleted
  secondsOnBattery: '1.3.6.1.2.1.33.1.2.2.0',
  minutesRemaining: '1.3.6.1.2.1.33.1.2.3.0',
  chargePct: '1.3.6.1.2.1.33.1.2.4.0',
  batteryVoltage: '1.3.6.1.2.1.33.1.2.5.0', // 0.1 VDC
  batteryTemp: '1.3.6.1.2.1.33.1.2.7.0', // deg C
  inputFrequency: '1.3.6.1.2.1.33.1.3.3.1.2.1', // 0.1 Hz
  inputVoltage: '1.3.6.1.2.1.33.1.3.3.1.3.1', // RMS V
  outputSource: '1.3.6.1.2.1.33.1.4.1.0', // 1 other,2 none,3 normal,4 bypass,5 battery,6 booster,7 reducer
  outputFrequency: '1.3.6.1.2.1.33.1.4.2.0', // 0.1 Hz
  outputVoltage: '1.3.6.1.2.1.33.1.4.4.1.2.1', // RMS V
  outputCurrent: '1.3.6.1.2.1.33.1.4.4.1.3.1', // 0.1 A
  outputPower: '1.3.6.1.2.1.33.1.4.4.1.4.1', // Watts
  outputLoadPct: '1.3.6.1.2.1.33.1.4.4.1.5.1', // percent
} as const;

// --- CyberPower RMCARD (1.3.6.1.4.1.3808.1.1.1.*) ---
// Voltages/currents/frequencies are in tenths; power/load/capacity are
// whole units; runtime is TimeTicks (1/100 s).
const CPS = {
  model: '1.3.6.1.4.1.3808.1.1.1.1.1.1.0',
  ratedPowerW: '1.3.6.1.4.1.3808.1.1.1.1.2.7.0', // Watts
  batteryStatus: '1.3.6.1.4.1.3808.1.1.1.2.1.1.0', // 1 unknown, 2 normal, 3 low
  batteryTemp: '1.3.6.1.4.1.3808.1.1.1.2.1.4.0', // deg C
  chargePct: '1.3.6.1.4.1.3808.1.1.1.2.2.1.0', // percent
  batteryVoltage: '1.3.6.1.4.1.3808.1.1.1.2.2.2.0', // 0.1 V
  runtimeTicks: '1.3.6.1.4.1.3808.1.1.1.2.2.4.0', // TimeTicks (1/100 s)
  inputVoltage: '1.3.6.1.4.1.3808.1.1.1.3.2.1.0', // 0.1 V
  inputFrequency: '1.3.6.1.4.1.3808.1.1.1.3.2.4.0', // 0.1 Hz
  outputStatus: '1.3.6.1.4.1.3808.1.1.1.4.1.1.0', // 2 onLine, 3 onBattery, 4 onBoost, 9 onBypass, 10 onBuck, ...
  outputVoltage: '1.3.6.1.4.1.3808.1.1.1.4.2.1.0', // 0.1 V
  outputFrequency: '1.3.6.1.4.1.3808.1.1.1.4.2.2.0', // 0.1 Hz
  outputLoadPct: '1.3.6.1.4.1.3808.1.1.1.4.2.3.0', // percent
  outputCurrent: '1.3.6.1.4.1.3808.1.1.1.4.2.4.0', // 0.1 A
  outputPower: '1.3.6.1.4.1.3808.1.1.1.4.2.5.0', // Watts
} as const;

// --- APC PowerNet-MIB (1.3.6.1.4.1.318.1.1.1.*) ---
const APC = {
  model: '1.3.6.1.4.1.318.1.1.1.1.1.1.0',
  name: '1.3.6.1.4.1.318.1.1.1.1.1.2.0',
  batteryStatus: '1.3.6.1.4.1.318.1.1.1.2.1.1.0', // 1 unknown, 2 normal, 3 low
  chargePct: '1.3.6.1.4.1.318.1.1.1.2.2.1.0',
  batteryTemp: '1.3.6.1.4.1.318.1.1.1.2.2.2.0',
  runtimeTicks: '1.3.6.1.4.1.318.1.1.1.2.2.3.0', // TimeTicks (1/100 s)
  batteryVoltage: '1.3.6.1.4.1.318.1.1.1.2.2.8.0', // V
  inputVoltage: '1.3.6.1.4.1.318.1.1.1.3.2.1.0', // V
  inputFrequency: '1.3.6.1.4.1.318.1.1.1.3.2.4.0', // Hz
  outputStatus: '1.3.6.1.4.1.318.1.1.1.4.1.1.0', // 2 onLine, 3 onBattery, ...
  outputVoltage: '1.3.6.1.4.1.318.1.1.1.4.2.1.0', // V
  outputFrequency: '1.3.6.1.4.1.318.1.1.1.4.2.2.0', // Hz
  outputLoadPct: '1.3.6.1.4.1.318.1.1.1.4.2.3.0', // percent
  outputCurrent: '1.3.6.1.4.1.318.1.1.1.4.2.4.0', // A
  outputPower: '1.3.6.1.4.1.318.1.1.1.4.2.8.0', // Watts (newer models)
} as const;

const SYS_OBJECT_ID = '1.3.6.1.2.1.1.2.0';

const STD_OIDS = Object.values(STD);
const CPS_OIDS = Object.values(CPS);
const APC_OIDS = Object.values(APC);

type Vendor = 'cyberpower' | 'apc' | 'generic';

/** Map an enterprise number (from sysObjectID) to a known UPS vendor. */
function vendorFromEnterprise(sysObjectId: string | null): Vendor {
  if (!sysObjectId) return 'generic';
  if (sysObjectId.startsWith('1.3.6.1.4.1.3808')) return 'cyberpower';
  if (sysObjectId.startsWith('1.3.6.1.4.1.318')) return 'apc';
  return 'generic';
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.trim();
    return s.length ? s : null;
  }
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** First non-null argument. Inputs are already scaled to base units by the
 *  caller, so ordering encodes source preference, not scale. */
function coalesce(...vals: Array<number | null>): number | null {
  for (const v of vals) if (v !== null) return v;
  return null;
}

function scale(n: number | null, factor: number): number | null {
  return n === null ? null : n * factor;
}

/** Battery status: RFC 1628's 4-state (its low/depleted split is a superset
 *  of the vendor MIBs' 3-state) mapped to our enum. Vendor MIBs use the same
 *  1/2/3 codes for unknown/normal/low, so this maps them too. */
function batteryStatus(v: number | null): UpsInfo['batteryStatus'] {
  switch (v) {
    case 2:
      return 'normal';
    case 3:
      return 'low';
    case 4:
      return 'depleted';
    default:
      return 'unknown';
  }
}

const STD_OUTPUT_SOURCE: Record<number, UpsInfo['outputSource']> = {
  1: 'other',
  2: 'none',
  3: 'normal',
  4: 'bypass',
  5: 'battery',
  6: 'booster',
  7: 'reducer',
};

/** Map a CyberPower/APC basic output-status code to the neutral vocabulary.
 *  The two vendors share the low codes (2 onLine, 3 onBattery); CyberPower
 *  adds boost/buck/bypass variants. Used only when RFC 1628's upsOutputSource
 *  is absent. */
function vendorOutputSource(v: number | null): UpsInfo['outputSource'] | null {
  switch (v) {
    case null:
    case undefined:
      return null;
    case 2: // onLine
    case 8: // CyberPower onECO
      return 'normal';
    case 3: // onBattery
      return 'battery';
    case 4: // onBoost / onSmartBoost
      return 'booster';
    case 10: // CyberPower onBuck
    case 12: // APC onSmartTrim
      return 'reducer';
    case 9: // onBypass
      return 'bypass';
    case 5: // sleeping / timed
    case 6: // off / software bypass
    case 7: // rebooting / off
      return 'none';
    default:
      return 'other';
  }
}

export type UpsClientOpts = {
  host: string;
  community: string;
  port: number;
};

export class UpsClient {
  private snmp: SnmpClient;
  private vendor: Vendor | null = null;

  constructor(opts: UpsClientOpts) {
    // UPS network cards are slow and sometimes flaky, so give each request
    // more time and an extra retry than the UDM path uses.
    this.snmp = new SnmpClient({
      host: opts.host,
      community: opts.community,
      port: opts.port,
      timeoutMs: 4000,
      retries: 2,
    });
  }

  close(): void {
    this.snmp.close();
  }

  /** OIDs to request for the detected vendor: always RFC 1628, plus the
   *  matching enterprise MIB. Querying only the supported MIB avoids the
   *  whole-PDU `noSuchName` that strict cards (e.g. CyberPower's RMCARD)
   *  raise when a GET includes an OID they don't implement. */
  private oidsForVendor(): string[] {
    if (this.vendor === 'cyberpower') return [...STD_OIDS, ...CPS_OIDS];
    if (this.vendor === 'apc') return [...STD_OIDS, ...APC_OIDS];
    return STD_OIDS;
  }

  /** Identify the UPS vendor once from sysObjectID so subsequent polls query
   *  only the relevant MIBs. Best-effort: on failure we stay 'generic'
   *  (RFC 1628 only) and retry detection on the next poll. */
  private async detectVendor(): Promise<void> {
    try {
      const m = await this.snmp.getValues([SYS_OBJECT_ID], 1, 3);
      const raw = m.get(SYS_OBJECT_ID);
      const sysObjectId = typeof raw === 'string' ? raw : raw == null ? null : String(raw);
      this.vendor = vendorFromEnterprise(sysObjectId);
    } catch {
      // leave undetected; poll() falls back to a generic RFC 1628 read
    }
  }

  /** Poll the UPS once. Throws only if SNMP itself is unreachable (timeout);
   *  a reachable UPS that implements a partial MIB yields an UpsInfo with
   *  nulls for the unsupported fields. */
  async poll(): Promise<UpsInfo> {
    if (this.vendor === null) await this.detectVendor();
    const m = await this.snmp.getValues(this.oidsForVendor());
    const g = (oid: string) => (m.has(oid) ? num(m.get(oid)) : null);

    const manufacturer = normalizeVendor(str(m.get(STD.manufacturer)));
    const model = str(m.get(STD.model)) ?? str(m.get(CPS.model)) ?? str(m.get(APC.model)) ?? str(m.get(APC.name));

    const status = batteryStatus(
      coalesce(g(STD.batteryStatus), g(CPS.batteryStatus), g(APC.batteryStatus)),
    );

    // Output source: RFC 1628 first (richest enum), then the vendor basic
    // status codes.
    const stdSrc = g(STD.outputSource);
    let outputSource: UpsInfo['outputSource'] = 'unknown';
    if (stdSrc !== null) {
      outputSource = STD_OUTPUT_SOURCE[stdSrc] ?? 'unknown';
    } else {
      outputSource = vendorOutputSource(coalesce(g(CPS.outputStatus), g(APC.outputStatus))) ?? 'unknown';
    }

    const secondsOnBattery = coalesce(g(STD.secondsOnBattery));
    // Runtime remaining: RFC 1628 gives whole minutes; the vendor MIBs give
    // TimeTicks (hundredths of a second).
    const minutesRemaining = coalesce(
      g(STD.minutesRemaining),
      scale(g(CPS.runtimeTicks), 1 / 6000),
      scale(g(APC.runtimeTicks), 1 / 6000),
    );

    const loadPct = coalesce(g(STD.outputLoadPct), g(CPS.outputLoadPct), g(APC.outputLoadPct));

    // Real output power. RFC 1628's upsOutputPower is 0 on UPSes that only
    // meter Watts in their enterprise MIB (CyberPower), so vendor OIDs win.
    // Last resort: derive from load% × rated Watts if the UPS advertises a
    // rating, so the tile isn't stuck at 0 under a real load.
    let outputPowerW = coalesce(g(CPS.outputPower), g(APC.outputPower), g(STD.outputPower));
    if ((outputPowerW === null || outputPowerW === 0) && loadPct !== null && loadPct > 0) {
      const rated = g(CPS.ratedPowerW);
      if (rated !== null && rated > 0) outputPowerW = Math.round((loadPct / 100) * rated);
    }

    // Output current, same vendor-first reasoning (RFC 1628 reads 0 here).
    const outputCurrentA = coalesce(
      scale(g(CPS.outputCurrent), 0.1),
      g(APC.outputCurrent),
      scale(g(STD.outputCurrent), 0.1),
    );

    const onBattery =
      outputSource === 'battery' ||
      status === 'low' ||
      status === 'depleted' ||
      (secondsOnBattery !== null && secondsOnBattery > 0);

    return {
      reachable: true,
      manufacturer,
      model,
      batteryStatus: status,
      onBattery,
      secondsOnBattery,
      minutesRemaining: minutesRemaining === null ? null : Math.round(minutesRemaining),
      chargePct: coalesce(g(STD.chargePct), g(CPS.chargePct), g(APC.chargePct)),
      batteryVoltage: coalesce(
        scale(g(STD.batteryVoltage), 0.1),
        scale(g(CPS.batteryVoltage), 0.1),
        g(APC.batteryVoltage),
      ),
      batteryTempC: coalesce(g(STD.batteryTemp), g(CPS.batteryTemp), g(APC.batteryTemp)),
      inputVoltage: coalesce(g(STD.inputVoltage), scale(g(CPS.inputVoltage), 0.1), g(APC.inputVoltage)),
      inputFrequencyHz: coalesce(
        scale(g(STD.inputFrequency), 0.1),
        scale(g(CPS.inputFrequency), 0.1),
        g(APC.inputFrequency),
      ),
      outputSource,
      outputVoltage: coalesce(g(STD.outputVoltage), scale(g(CPS.outputVoltage), 0.1), g(APC.outputVoltage)),
      outputFrequencyHz: coalesce(
        scale(g(STD.outputFrequency), 0.1),
        scale(g(CPS.outputFrequency), 0.1),
        g(APC.outputFrequency),
      ),
      outputCurrentA: outputCurrentA === null ? null : Math.round(outputCurrentA * 10) / 10,
      outputPowerW,
      loadPct,
    };
  }
}

/** Expand terse manufacturer codes some UPSes report in upsIdentManufacturer
 *  (CyberPower's card returns "CPS") into a readable name. */
function normalizeVendor(v: string | null): string | null {
  if (!v) return v;
  const map: Record<string, string> = {
    CPS: 'CyberPower',
    APC: 'APC',
  };
  return map[v] ?? v;
}
