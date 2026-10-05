<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { formatUptime, num } from '$lib/format';
  import Panel from '$lib/components/Panel.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import Meter from '$lib/components/Meter.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';

  /** UPS state. The headline is the power source; everything else is the
   *  electrical detail and an hour of load / line-voltage history. */
  let { active = true }: { active?: boolean } = $props();

  const ups = $derived(panel.ups);
  const configured = $derived(panel.features.upsAvailable);
  const live = $derived(!!ups && ups.reachable);
  const onBattery = $derived(!!ups?.onBattery);
  const batteryDegraded = $derived(ups?.batteryStatus === 'low' || ups?.batteryStatus === 'depleted');

  const sourceLabel = $derived.by(() => {
    if (!ups) return '—';
    if (onBattery) return 'On battery';
    switch (ups.outputSource) {
      case 'normal':
        return 'On mains';
      case 'bypass':
        return 'Bypass';
      case 'booster':
        return 'Boost';
      case 'reducer':
        return 'Trim';
      case 'none':
        return 'Output off';
      default:
        return ups.outputSource;
    }
  });
  const sourceTone = $derived(onBattery ? 'crit' : batteryDegraded ? 'warn' : 'ok');
  const chargeTone = $derived((ups?.chargePct ?? 100) < 20 ? 'crit' : (ups?.chargePct ?? 100) < 50 ? 'warn' : 'none');
  const loadTone = $derived((ups?.loadPct ?? 0) >= 90 ? 'crit' : (ups?.loadPct ?? 0) >= 80 ? 'warn' : 'none');
  const identity = $derived([ups?.manufacturer, ups?.model].filter(Boolean).join(' ') || 'Unidentified UPS');

  const loadHist = $derived(panel.upsHistory.map((s) => s.loadPct));
  const voltHist = $derived(panel.upsHistory.map((s) => s.inputVoltage));
  const powerHist = $derived(panel.upsHistory.map((s) => s.outputPowerW));
  const minmax = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null;
  };
  const loadRange = $derived(minmax(loadHist));
  const voltRange = $derived(minmax(voltHist));
</script>

{#if !configured}
  <div class="single" data-active={active}>
    <Panel title="Power">
      <div class="empty"><strong>UPS monitoring is not configured</strong>Set UPS_HOST in the panel environment to poll a network-managed UPS over SNMP</div>
    </Panel>
  </div>
{:else if !live || !ups}
  <div class="single" data-active={active}>
    <Panel title="Power" tone="warn">
      <div class="empty"><strong>UPS unreachable</strong>The UPS SNMP agent is not answering — check the host and community</div>
    </Panel>
  </div>
{:else}
  <div class="power" data-active={active}>
    <Panel title="UPS" tone={sourceTone}>
      {#snippet meta()}<span>{identity}</span><span>Battery {ups.batteryStatus}</span>{/snippet}
      <div class="hero">
        <Stat label="Power source" value={sourceLabel} size="xl" tone={sourceTone === 'ok' ? 'none' : sourceTone} sub={onBattery && ups.secondsOnBattery ? `${formatUptime(ups.secondsOnBattery)} on battery` : ''} />
        <Stat label="Load" value={num(ups.loadPct)} unit="%" size="lg" tone={loadTone}>
          <Meter value={ups.loadPct} warn={80} crit={90} />
        </Stat>
        <Stat label="Output power" value={num(ups.outputPowerW)} unit="W" size="lg" sub={ups.outputCurrentA != null ? `${num(ups.outputCurrentA, 1)} A` : ''} />
        <Stat label="Battery charge" value={num(ups.chargePct)} unit="%" size="lg" tone={chargeTone}>
          <Meter value={ups.chargePct} tone={chargeTone === 'none' ? 'ok' : chargeTone} />
        </Stat>
        <Stat label="Runtime remaining" value={ups.minutesRemaining != null ? formatUptime(ups.minutesRemaining * 60) : '—'} size="lg" tone={chargeTone} />
      </div>
    </Panel>

    <Panel title="Electrical">
      <div class="elec">
        <Stat label="Input" value={num(ups.inputVoltage)} unit="V" sub={ups.inputFrequencyHz != null ? `${num(ups.inputFrequencyHz, 1)} Hz` : ''} />
        <Stat label="Output" value={num(ups.outputVoltage)} unit="V" sub={ups.outputFrequencyHz != null ? `${num(ups.outputFrequencyHz, 1)} Hz` : ''} />
        <Stat label="Output current" value={num(ups.outputCurrentA, 1)} unit="A" />
        <Stat label="Battery voltage" value={num(ups.batteryVoltage, 1)} unit="V" />
        <Stat label="Battery temperature" value={ups.batteryTempC != null ? num(ups.batteryTempC) : '—'} unit="°C" />
        <Stat label="Output source" value={ups.outputSource} />
      </div>
    </Panel>

    <Panel title="Load">
      {#snippet meta()}
        <span>Last hour</span>
        {#if loadRange}<span>{num(loadRange.min)}–{num(loadRange.max)}%</span>{/if}
      {/snippet}
      <div class="trend">
        <Sparkline values={loadHist} min={0} max={100} height={260} color="var(--accent)" />
        <div class="trend-foot"><span>0%</span><span>100%</span></div>
      </div>
    </Panel>

    <Panel title="Input voltage">
      {#snippet meta()}
        <span>Last hour</span>
        {#if voltRange}<span>{num(voltRange.min)}–{num(voltRange.max)} V</span>{/if}
      {/snippet}
      <div class="trend">
        <Sparkline values={voltHist} height={260} color="var(--accent)" />
        <div class="trend-foot"><span>Line voltage</span><span>{num(ups.inputVoltage)} V now</span></div>
      </div>
    </Panel>

    <Panel title="Output power">
      {#snippet meta()}<span>Last hour</span>{/snippet}
      <div class="trend">
        <Sparkline values={powerHist} min={0} height={260} color="var(--tx)" />
        <div class="trend-foot"><span>Watts</span><span>{num(ups.outputPowerW)} W now</span></div>
      </div>
    </Panel>
  </div>
{/if}

<style>
  .single {
    height: 100%;
    display: grid;
  }
  .power {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: auto minmax(0, 1fr);
    gap: 1rem;
    height: 100%;
    min-height: 0;
  }
  .power > :global(.panel:first-child) {
    grid-column: 1 / 3;
  }
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) repeat(4, minmax(0, 1fr));
    gap: 1.5rem;
    align-items: start;
    padding: 0.4rem 0 0.6rem;
  }
  .elec {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.9rem 1.2rem;
    align-content: start;
    padding-top: 0.3rem;
  }
  .trend {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.5rem;
    height: 100%;
  }
  .trend-foot {
    display: flex;
    justify-content: space-between;
    font-size: 0.72rem;
    color: var(--ink-3);
  }
</style>
