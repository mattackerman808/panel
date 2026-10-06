import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { createMockWorld } from './mock.js';
import { autoDetectWanInterfaces, resolveWanInterfaces, SnmpClient, type SnmpInterface } from './snmp.js';
import { store } from './store.js';
import type {
  ClientStat,
  DailyUsage,
  DpiCategory,
  HealthSubsystem,
  NetworkDevice,
  UdmInfo,
  UpsInfo,
  Wan,
  WanStatus,
} from './types.js';
import { UpsClient } from './ups.js';
import { type GatewayWanDetails, UnifiClient } from './unifi.js';

/** Month-to-date and per-day counters per WAN, persisted across restarts.
 *
 *  The scheme is delta-based: each tick we compute `currentTotal - lastTotal`,
 *  add it to the month bucket and today's bucket, and update `lastTotal`. A
 *  negative delta (UDM/SNMP counter reset) is treated as 0. On month rollover
 *  the monthly bucket resets and `lastTotal` is re-seeded from the current
 *  total. Day buckets are keyed by date so they survive the month rollover
 *  and give the UI a trailing 31-day usage history. */
type MonthlyEntry = { lastRx: number; lastTx: number; monthRx: number; monthTx: number };
type DayEntry = { rx: number; tx: number };
type MonthlyState = {
  month: string;
  wans: Record<string, MonthlyEntry>;
  /** wanId → YYYY-MM-DD → bytes */
  days: Record<string, Record<string, DayEntry>>;
};

const MONTHLY_PATH = join(process.cwd(), 'data', 'monthly.json');
const MONTHLY_WRITE_INTERVAL_MS = 30_000;
const DAYS_KEPT = 31;

/** Consecutive failed getCounters polls before we assume our latched
 *  ifIndexes are stale and fall back to re-discovery. At the default 2s
 *  tick that's ~30s of failures. */
const COUNTER_FAILURE_LIMIT = 15;

function currentMonthLabel(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentDayLabel(d = new Date()): string {
  return `${currentMonthLabel(d)}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadMonthlyState(): MonthlyState {
  try {
    const text = readFileSync(MONTHLY_PATH, 'utf8');
    const parsed = JSON.parse(text) as Partial<MonthlyState>;
    if (parsed && typeof parsed.month === 'string' && parsed.wans) {
      // `days` arrived with the daily-usage feature; older files lack it.
      return { month: parsed.month, wans: parsed.wans, days: parsed.days ?? {} };
    }
  } catch {
    // first run, missing file, or corrupt — fall through to fresh state
  }
  return { month: currentMonthLabel(), wans: {}, days: {} };
}

function saveMonthlyState(state: MonthlyState): void {
  try {
    mkdirSync(dirname(MONTHLY_PATH), { recursive: true });
    writeFileSync(MONTHLY_PATH, JSON.stringify(state));
  } catch (err) {
    console.error('[poller] failed to persist monthly state:', err);
  }
}

/** Flatten the day buckets into the wire shape (oldest first, last 31 days)
 *  and prune anything older from the state. */
function usageDailyFrom(state: MonthlyState): Record<string, DailyUsage[]> {
  const out: Record<string, DailyUsage[]> = {};
  for (const [wanId, days] of Object.entries(state.days)) {
    const dates = Object.keys(days).sort();
    for (const stale of dates.slice(0, Math.max(0, dates.length - DAYS_KEPT))) delete days[stale];
    out[wanId] = dates.slice(-DAYS_KEPT).map((date) => ({ date, rxBytes: days[date]!.rx, txBytes: days[date]!.tx }));
  }
  return out;
}

type WanRuntime = {
  id: string;
  ifIndex: number;
  ifName: string;
  label: string;
  speedBitsPerSec: number;
  prevRx: number;
  prevTx: number;
  prevTs: number;
  rxTotal: number;
  txTotal: number;
  rxBps: number;
  txBps: number;
};

export async function startPoller(): Promise<void> {
  store.recordEvent({
    severity: 'info',
    kind: 'server.start',
    subject: 'panel',
    message: `Panel server started (${config.mock ? 'mock' : 'live'} mode)`,
  });

  if (config.mock) {
    await startMockPoller();
    return;
  }

  // === LIVE mode ===
  const unifi = new UnifiClient({
    host: config.udm.host,
    apiKey: config.udm.apiKey || undefined,
    username: config.udm.username || undefined,
    password: config.udm.password || undefined,
    site: config.udm.site,
    insecureTls: config.udm.insecureTls,
  });

  let unifiOk = false;
  let controllerOutageEvented = false;
  try {
    await unifi.connect();
    unifiOk = true;
    console.log(`[poller] connected to UDM API at ${config.udm.host} (mode: ${unifi.getMode()})`);
  } catch (err) {
    console.error('[poller] UDM API connection failed:', err);
    store.recordEvent({ severity: 'warn', kind: 'controller.lost', subject: 'UniFi', message: 'UniFi controller unreachable' });
    controllerOutageEvented = true;
  }
  store.setSource('live');
  const publishFeatures = (snmpAvailable: boolean): void => {
    const legacy = unifiOk && unifi.getMode() === 'legacy';
    store.setFeatures({
      dpiAvailable: legacy,
      perClientRates: legacy,
      snmpAvailable,
      upsAvailable: config.ups.enabled,
      controllerAvailable: unifiOk,
    });
  };
  publishFeatures(false);

  // === UPS setup (optional; independent of the UDM). Polled on its own
  //     cadence and pushed with each tick. A missing/unreachable UPS never
  //     blocks the WAN pipeline — poll errors just null out `lastUps`. ===
  const upsClient = config.ups.enabled
    ? new UpsClient({
        host: config.ups.host,
        community: config.ups.community,
        port: config.ups.port,
      })
    : null;
  let lastUps: UpsInfo | null = null;
  let upsAt = 0;
  if (upsClient) {
    console.log(`[poller] UPS SNMP enabled at ${config.ups.host}`);
  }

  // === SNMP setup ===
  const snmpClient = new SnmpClient({
    host: config.udm.host,
    community: config.snmp.community,
    port: config.snmp.port,
  });

  const fmtIfaces = (ifs: { ifIndex: number; ifName: string }[]): string =>
    ifs.map((i) => `${i.ifIndex}=${i.ifName}`).join(', ') || 'none';

  /** One WAN discovery pass: walk the interface table, then pick out the
   *  WANs. Throws if SNMP itself is unreachable; returns [] if the walk
   *  succeeded but nothing looked like a WAN. Callers retry — see the
   *  recovery block in `tick`. */
  const discoverWanInterfaces = async (): Promise<SnmpInterface[]> => {
    const interfaces = await snmpClient.listInterfaces();
    console.log(`[poller] SNMP discovered ${interfaces.length} interfaces`);

    if (config.snmp.wanIfIndexes.length > 0) {
      const configured = config.snmp.wanIfIndexes
        .map((idx) => interfaces.find((i) => i.ifIndex === idx))
        .filter((i): i is SnmpInterface => !!i);
      console.log(`[poller] using configured WAN ifIndexes: ${fmtIfaces(configured)}`);
      return configured;
    }

    // Self-heal: prefer the UniFi controller's own WAN1/WAN2 designation
    // (the user already maintains this in the UniFi UI). If the controller
    // isn't reachable or doesn't expose ifNames, fall back to identifying
    // WANs by the presence of a routable public IPv4 (see
    // autoDetectWanInterfaces).
    let controllerIfNames: string[] = [];
    if (unifiOk) {
      try {
        const details = await unifi.getWanDetails();
        controllerIfNames = details.map((d) => d.ifName).filter((n) => n);
      } catch (err) {
        console.error('[poller] controller WAN designation lookup failed:', err);
      }
    }
    if (controllerIfNames.length > 0) {
      const designated = resolveWanInterfaces(interfaces, controllerIfNames);
      console.log(
        `[poller] controller-designated WAN interfaces: ${fmtIfaces(designated)} (from ${controllerIfNames.join(',')})`,
      );
      if (designated.length > 0) return designated;
    }
    const auto = autoDetectWanInterfaces(interfaces);
    console.log(
      `[poller] auto-detected WAN interfaces: ${auto.map((i) => `${i.ifIndex}=${i.ifName} ip=${i.ipv4Addrs.join('|') || '-'}`).join(', ') || 'none'}`,
    );
    return auto;
  };

  // WAN runtime state is rebuilt whenever discovery succeeds, so a later
  // re-discovery (recovery, or ifIndex drift after a UDM firmware update)
  // swaps the interface set without restarting the process. Monthly
  // counters are keyed by `wan1`/`wan2` and survive the swap.
  let wans: WanRuntime[] = [];
  let snmpOk = false;
  let snmpOutageEvented = false;
  let recoveryAt = 0;
  let counterFailures = 0;

  /** Adopt a freshly discovered interface set as the live WAN list.
   *  Labels come from env, falling back to "WAN N". ifName is walked from
   *  the canonical SNMP ifName OID (1.3.6.1.2.1.31.1.1.1.1) — a kernel name
   *  like "eth12"; ifAlias is only a fallback for agents without ifName. */
  const adoptWans = (ifaces: SnmpInterface[]): void => {
    wans = ifaces.map((iface, i) => ({
      id: `wan${i + 1}`,
      ifIndex: iface.ifIndex,
      ifName: iface.ifName || iface.ifAlias || `if${iface.ifIndex}`,
      label: config.snmp.wanLabels[i] ?? `WAN ${i + 1}`,
      speedBitsPerSec: iface.ifHighSpeedMbps * 1_000_000,
      prevRx: 0,
      prevTx: 0,
      prevTs: 0,
      rxTotal: 0,
      txTotal: 0,
      rxBps: 0,
      txBps: 0,
    }));
    snmpOk = wans.length > 0;
    counterFailures = 0;
    publishFeatures(snmpOk);
    if (snmpOk && snmpOutageEvented) {
      snmpOutageEvented = false;
      store.recordEvent({ severity: 'info', kind: 'snmp.ok', subject: 'SNMP', message: `WAN telemetry restored (${fmtIfaces(wans)})` });
    }
  };

  // Startup discovery with a short backoff, so the common transient case
  // (UDM SNMP agent returns one genErr) resolves in seconds rather than
  // waiting a full recovery interval. Persistent failure is no longer
  // fatal — `tick` keeps retrying every config.poll.recoveryMs.
  const backoffsMs = [0, 1000, 2000, 5000, 10000];
  for (let attempt = 0; attempt < backoffsMs.length; attempt++) {
    const delay = backoffsMs[attempt] ?? 0;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      adoptWans(await discoverWanInterfaces());
      if (snmpOk) break;
      console.error(`[poller] no WAN interfaces found (attempt ${attempt + 1}/${backoffsMs.length})`);
    } catch (err) {
      console.error(
        `[poller] SNMP discovery failed (attempt ${attempt + 1}/${backoffsMs.length}):`,
        err,
      );
    }
  }
  if (!snmpOk) {
    console.error(
      `[poller] starting without WAN interfaces — retrying every ${config.poll.recoveryMs}ms`,
    );
    snmpOutageEvented = true;
    store.recordEvent({ severity: 'warn', kind: 'snmp.lost', subject: 'SNMP', message: 'WAN telemetry unavailable — SNMP discovery found no WAN interfaces' });
  }

  // Monthly/daily counter state: rebuilt from on-disk state at startup so a
  // panel-server restart doesn't lose month-to-date numbers.
  const monthly = loadMonthlyState();
  let monthlyDirty = false;
  let monthlySavedAt = 0;
  let usageDailyOut: Record<string, DailyUsage[]> | null = usageDailyFrom(monthly);
  // Per-WAN gateway details (IPv6, latest WAN IP, negotiated speed) refreshed
  // on the udmInfoMs cadence — lifetime byte counters from the gateway aren't
  // used for monthly tracking (SNMP is more frequent and authoritative).
  let lastWanDetails: GatewayWanDetails[] = [];

  // === Per-client rate computation (legacy API caches counters at ~30s, so
  //     we poll at 60s and derive rates from byte deltas). ===
  type Prev = { rxBytes: number; txBytes: number; ts: number };
  let prevByClient = new Map<string, Prev>();
  function deriveClientRates(input: ClientStat[]): ClientStat[] {
    const now = Date.now();
    const next = new Map<string, Prev>();
    const out = input.map((c) => {
      const key = c.id || c.mac;
      const prev = prevByClient.get(key);
      let rxBps = c.rxBps;
      let txBps = c.txBps;
      if (prev && now > prev.ts) {
        const dt = (now - prev.ts) / 1000;
        if (dt > 0 && dt < 600) {
          const drx = c.rxBytes - prev.rxBytes;
          const dtx = c.txBytes - prev.txBytes;
          if (drx >= 0) rxBps = drx / dt;
          if (dtx >= 0) txBps = dtx / dt;
        }
      }
      next.set(key, { rxBytes: c.rxBytes, txBytes: c.txBytes, ts: now });
      return { ...c, rxBps, txBps };
    });
    prevByClient = next;
    return out;
  }

  let lastClients: ClientStat[] = [];
  let lastDpi: DpiCategory[] = [];
  let lastDpiCategories: DpiCategory[] = [];
  let lastUdm: UdmInfo | null = null;
  let lastDevices: NetworkDevice[] = [];
  let lastHealth: HealthSubsystem[] = [];
  let clientsAt = 0;
  let dpiAt = 0;
  let udmAt = 0;

  // === Tick: SNMP every wanMs, legacy stuff on slower cadences ===
  const tick = async (): Promise<void> => {
    const now = Date.now();

    // Recovery: whatever came up dead gets re-attempted here. The Pi can
    // start panel.service before eth0 has an address (ENETUNREACH), which
    // would otherwise leave the dashboard blank until a manual restart.
    if ((!snmpOk || !unifiOk) && now - recoveryAt >= config.poll.recoveryMs) {
      recoveryAt = now;
      if (!unifiOk) {
        try {
          await unifi.connect();
          unifiOk = true;
          console.log(`[poller] UDM API recovered (mode: ${unifi.getMode()})`);
          publishFeatures(snmpOk);
          if (controllerOutageEvented) {
            controllerOutageEvented = false;
            store.recordEvent({ severity: 'info', kind: 'controller.ok', subject: 'UniFi', message: 'UniFi controller reachable again' });
          }
        } catch (err) {
          console.error('[poller] UDM API still unreachable:', err);
        }
      }
      if (!snmpOk) {
        try {
          adoptWans(await discoverWanInterfaces());
          if (snmpOk) console.log(`[poller] SNMP recovered: ${fmtIfaces(wans)}`);
        } catch (err) {
          console.error('[poller] SNMP discovery retry failed:', err);
        }
      }
    }

    // SNMP: read counters, compute rates from previous reading.
    if (snmpOk) {
      try {
        const counters = await snmpClient.getCounters(wans.map((w) => w.ifIndex));
        counterFailures = 0;
        for (const w of wans) {
          const c = counters.find((x) => x.ifIndex === w.ifIndex);
          if (!c) continue;
          if (w.prevTs > 0 && now > w.prevTs) {
            const dt = (now - w.prevTs) / 1000;
            if (dt > 0 && dt < 30) {
              const drx = c.rxOctets - w.prevRx;
              const dtx = c.txOctets - w.prevTx;
              if (drx >= 0) w.rxBps = drx / dt;
              if (dtx >= 0) w.txBps = dtx / dt;
            }
          }
          w.prevRx = c.rxOctets;
          w.prevTx = c.txOctets;
          w.prevTs = now;
          w.rxTotal = c.rxOctets;
          w.txTotal = c.txOctets;
        }
      } catch (err) {
        counterFailures++;
        console.error(`[poller] SNMP getCounters failed (${counterFailures}x):`, err);
        // Sustained counter failures mean the ifIndexes we latched onto are
        // gone (UDM firmware update renumbers them) or the agent went away.
        // Drop back to discovery rather than polling dead indexes forever.
        if (counterFailures >= COUNTER_FAILURE_LIMIT) {
          console.error('[poller] too many consecutive counter failures — re-discovering WANs');
          snmpOk = false;
          publishFeatures(false);
          recoveryAt = 0;
          if (!snmpOutageEvented) {
            snmpOutageEvented = true;
            store.recordEvent({ severity: 'warn', kind: 'snmp.lost', subject: 'SNMP', message: 'WAN telemetry lost — SNMP counters stopped answering' });
          }
        }
      }
    }

    // Controller calls on their slower cadences. A failure on any of them
    // marks the controller down so the recovery loop re-authenticates.
    const tasks: Promise<unknown>[] = [];
    const controllerFailed = (what: string) => (e: unknown) => {
      console.error(`[poller] ${what} error`, e);
      if (unifiOk && isConnectivityError(e)) {
        unifiOk = false;
        publishFeatures(snmpOk);
        if (!controllerOutageEvented) {
          controllerOutageEvented = true;
          store.recordEvent({ severity: 'warn', kind: 'controller.lost', subject: 'UniFi', message: 'UniFi controller stopped responding' });
        }
      }
    };
    if (unifiOk && now - clientsAt >= config.poll.clientsMs) {
      clientsAt = now;
      tasks.push(
        unifi
          .getClients()
          .then((c) => {
            lastClients = deriveClientRates(c);
          })
          .catch(controllerFailed('clients')),
      );
    }
    if (unifiOk && now - dpiAt >= config.poll.dpiMs) {
      dpiAt = now;
      tasks.push(
        unifi
          .getTraffic()
          .then(({ apps, categories }) => {
            lastDpi = apps;
            lastDpiCategories = categories;
          })
          .catch(controllerFailed('dpi')),
      );
    }
    if (unifiOk && now - udmAt >= config.poll.udmInfoMs) {
      udmAt = now;
      tasks.push(
        unifi
          .getUdmInfo()
          .then((u) => {
            if (u) lastUdm = u;
          })
          .catch(controllerFailed('udm info')),
      );
      tasks.push(
        unifi
          .getDevices()
          .then((d) => {
            lastDevices = d;
          })
          .catch(controllerFailed('devices')),
      );
      tasks.push(
        unifi
          .getHealth()
          .then((h) => {
            lastHealth = h;
          })
          .catch(controllerFailed('health')),
      );
      tasks.push(
        unifi
          .getWanDetails()
          .then((d) => {
            lastWanDetails = d;
          })
          .catch(controllerFailed('wan details')),
      );
    }

    // UPS: independent SNMP poll on its own cadence. A timeout (UPS down or
    // unreachable) nulls the reading rather than throwing — the dashboard
    // then shows the UPS as unreachable instead of dropping the whole tick.
    if (upsClient && now - upsAt >= config.poll.upsMs) {
      upsAt = now;
      tasks.push(
        upsClient
          .poll()
          .then((u) => {
            lastUps = u;
          })
          .catch((e) => {
            lastUps = lastUps ? { ...lastUps, reachable: false } : null;
            console.error('[poller] ups poll error', e instanceof Error ? e.message : e);
          }),
      );
    }
    await Promise.all(tasks);

    // Usage accumulators: roll the month over on calendar-month change, then
    // add this tick's SNMP counter delta to the month and to today's bucket.
    // Negative deltas (counter reset on UDM reboot) are clamped to 0.
    const monthLabel = currentMonthLabel();
    const dayLabel = currentDayLabel();
    if (monthly.month !== monthLabel) {
      monthly.month = monthLabel;
      monthly.wans = {};
      monthlyDirty = true;
    }
    if (snmpOk) {
      for (const w of wans) {
        const entry = monthly.wans[w.id] ?? { lastRx: 0, lastTx: 0, monthRx: 0, monthTx: 0 };
        const isFirstSeen = entry.lastRx === 0 && entry.lastTx === 0;
        if (!isFirstSeen) {
          const drx = Math.max(0, w.rxTotal - entry.lastRx);
          const dtx = Math.max(0, w.txTotal - entry.lastTx);
          entry.monthRx += drx;
          entry.monthTx += dtx;
          const days = (monthly.days[w.id] ??= {});
          const day = (days[dayLabel] ??= { rx: 0, tx: 0 });
          day.rx += drx;
          day.tx += dtx;
        }
        entry.lastRx = w.rxTotal;
        entry.lastTx = w.txTotal;
        monthly.wans[w.id] = entry;
        monthlyDirty = true;
      }
    }
    if (monthlyDirty && now - monthlySavedAt >= MONTHLY_WRITE_INTERVAL_MS) {
      usageDailyOut = usageDailyFrom(monthly);
      saveMonthlyState(monthly);
      monthlySavedAt = now;
      monthlyDirty = false;
    }

    // /stat/health returns one entry per WAN (`wan`, `wan2`) plus a `www`
    // aggregate. Per-WAN latency lives in the bucket keyed by WAN/WAN2 in
    // `uptime_stats` (handled in unifi.ts → toHealthSubsystem). With a single
    // WAN the controller may still only emit `wan`, so fall back to the first
    // entry then; with several WANs never cross-wire them.
    const wwwHealth = lastHealth.find((h) => h.name === 'www');
    const wanByOrder = lastHealth.filter((h) => h.name.startsWith('wan'));
    const detailsByIf = new Map(lastWanDetails.map((d) => [d.ifName, d]));
    const wanOut: Wan[] = wans.map((w, i) => {
      const det = detailsByIf.get(w.ifName) ?? null;
      const h = wanByOrder[i] ?? (wans.length === 1 ? wanByOrder[0] : undefined) ?? null;
      const monthEntry = monthly.wans[w.id];
      const dayEntry = monthly.days[w.id]?.[dayLabel];
      const envSpeedMbps = config.snmp.wanSpeedsMbps[i] ?? 0;
      const speedBitsPerSec =
        envSpeedMbps > 0
          ? envSpeedMbps * 1_000_000
          : det?.speedMbps
            ? det.speedMbps * 1_000_000
            : w.speedBitsPerSec;
      let status: WanStatus = 'unknown';
      if (h) status = h.status === 'ok' ? 'ok' : h.status === 'warning' ? 'degraded' : 'down';
      else if (det) status = det.up ? 'ok' : 'down';
      return {
        id: w.id,
        ifIndex: w.ifIndex,
        ifName: w.ifName,
        label: w.label,
        speedBitsPerSec,
        rxBps: w.rxBps,
        txBps: w.txBps,
        rxTotal: w.rxTotal,
        txTotal: w.txTotal,
        wanIp: det?.ip ?? h?.wanIp ?? null,
        wanIpv6: det?.ipv6 ?? null,
        status,
        latencyMs: h?.latencyMs ?? det?.latencyMs ?? wwwHealth?.latencyMs ?? null,
        monthRxBytes: monthEntry?.monthRx ?? 0,
        monthTxBytes: monthEntry?.monthTx ?? 0,
        monthLabel: monthly.month,
        dayRxBytes: dayEntry?.rx ?? 0,
        dayTxBytes: dayEntry?.tx ?? 0,
        dayLabel,
        ispName: h?.ispName ?? null,
        ispOrg: h?.ispOrg ?? null,
        asn: h?.asn ?? null,
        availabilityPct: h?.availabilityPct ?? det?.availabilityPct ?? null,
        uptimeSec: h?.uptimeSec ?? det?.uptimeSec ?? null,
        drops: h?.drops ?? null,
        monitors: h?.monitors ?? [],
      };
    });

    store.pushTick({
      wans: wanOut,
      ...(usageDailyOut ? { usageDaily: usageDailyOut } : {}),
      clients: lastClients.length ? lastClients : undefined,
      dpi: lastDpi.length ? lastDpi : undefined,
      dpiCategories: lastDpiCategories.length ? lastDpiCategories : undefined,
      udm: lastUdm ?? undefined,
      devices: lastDevices.length ? lastDevices : undefined,
      health: lastHealth.length ? lastHealth : undefined,
      ups: lastUps ?? undefined,
    });
    usageDailyOut = null;
  };

  await tick();
  setInterval(() => {
    void tick();
  }, config.poll.wanMs);
}

/** Network-level failures (refused, reset, DNS, timeout) and auth failures
 *  mean the controller itself is gone; a 4xx/5xx on one endpoint doesn't. */
function isConnectivityError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.message} ${(e as { code?: string }).code ?? ''} ${String(e.cause ?? '')}` : String(e);
  return /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|UND_ERR|fetch failed|login failed|TOKEN cookie/i.test(msg);
}

/** Mock mode: synthesize the whole fleet. The world is a pure function of
 *  time, so the last 15 minutes are replayed at startup to pre-fill every
 *  history (the kiosk never shows empty charts, even on a laptop). */
async function startMockPoller(): Promise<void> {
  console.log('[poller] running in MOCK mode');
  const world = createMockWorld();
  store.setSource('mock');
  store.setFeatures({ dpiAvailable: true, perClientRates: true, snmpAvailable: true, upsAvailable: true, controllerAvailable: true });
  world.seedEvents((e) => store.recordEvent(e));

  const { apps, categories } = world.dpi();
  let slowAt = 0;
  let clientsAt = 0;
  let usageAt = 0;
  const run = (t: number): void => {
    const wans = world.wans(t);
    const slow = t - slowAt >= config.poll.udmInfoMs;
    const clientsDue = t - clientsAt >= config.poll.clientsMs;
    const usageDue = t - usageAt >= MONTHLY_WRITE_INTERVAL_MS;
    if (slow) slowAt = t;
    if (clientsDue) clientsAt = t;
    if (usageDue) usageAt = t;
    store.pushTick(
      {
        wans,
        ...(usageDue ? { usageDaily: world.usageDaily(t) } : {}),
        ...(clientsDue ? { clients: world.clients(t), dpi: apps, dpiCategories: categories } : {}),
        ...(slow ? { devices: world.devices(t), udm: world.udm(t), health: world.health(wans, t), ups: world.ups(t) } : {}),
      },
      t,
    );
  };

  const now = Date.now();
  const span = config.history.maxSamples * config.poll.wanMs;
  const backfillStart = now - span;
  // Clients first so the gateway history has client counts from the start.
  clientsAt = backfillStart - config.poll.clientsMs;
  for (let t = backfillStart; t < now; t += config.poll.wanMs) run(t);
  console.log(`[poller] mock history backfilled (${Math.round(span / 60_000)} min)`);
  run(now);
  setInterval(() => run(Date.now()), config.poll.wanMs);
}
