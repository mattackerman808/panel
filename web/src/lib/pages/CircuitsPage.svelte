<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { circuitRows } from '$lib/derive';
  import { kwh, num, relativeTime } from '$lib/format';
  import type { RankedRow } from '$lib/ui';
  import Panel from '$lib/components/Panel.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import Meter from '$lib/components/Meter.svelte';
  import RankedBars from '$lib/components/RankedBars.svelte';
  import CircuitFlow from '$lib/components/CircuitFlow.svelte';
  import CircuitList from '$lib/components/CircuitList.svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { COMPACT_QUERY } from '$lib/ui';

  /** The Now page's power flow carried through the SPAN panel to every
   *  circuit (live draw, today's energy, breaker load), with today's energy
   *  ranked by circuit and the electrical service at the main lugs. */
  let { active = true }: { active?: boolean } = $props();
  /** On a phone the diagram's text would be a few pixels tall: there the
   *  flow is drawn top-down as a ranked list instead. */
  const compact = new MediaQuery(COMPACT_QUERY, false);

  const span = $derived(panel.span);
  const configured = $derived(panel.features.spanAvailable);
  const live = $derived(!!span && span.reachable);
  // The phone list scrolls, so it shows every circuit instead of folding
  // the idlest into "other circuits".
  const rows = $derived(
    circuitRows(span, panel.powerwall, { ups: panel.ups, upsCircuit: panel.ui.upsCircuit ?? null, maxRows: compact.current ? 99 : undefined }),
  );
  const today = $derived<RankedRow[]>(
    (span?.circuits ?? [])
      .filter((c) => !c.source && c.todayWh != null && c.todayWh > 0)
      .sort((a, b) => (b.todayWh ?? 0) - (a.todayWh ?? 0))
      .slice(0, 10)
      .map((c) => ({ id: c.id, label: c.name, value: c.todayWh ?? 0, text: kwh(c.todayWh).replace(' kWh', ''), unit: 'kWh' })),
  );
  const legTone = (a: number | null) => {
    const r = span?.serviceRatingA ?? 0;
    if (a == null || !r) return 'ok' as const;
    return a / r >= 0.9 ? ('crit' as const) : a / r >= 0.8 ? ('warn' as const) : ('ok' as const);
  };
</script>

{#if !configured}
  <div class="single" data-active={active}>
    <Panel title="Circuits">
      <div class="empty"><strong>SPAN monitoring is not configured</strong>Set SPAN_HOST and SPAN_PASSPHRASE in the panel environment</div>
    </Panel>
  </div>
{:else if !span}
  <div class="single" data-active={active}>
    <Panel title="Circuits" tone="warn">
      <div class="empty"><strong>Waiting for the SPAN panel</strong>No data from its MQTT broker yet</div>
    </Panel>
  </div>
{:else}
  <div class="circuits" data-active={active}>
    <Panel title="Circuits" tone={live ? 'none' : 'warn'} class="flow-panel">
      {#snippet meta()}
        <span>live draw · today · breaker load</span>
        <span>{live ? `updated ${relativeTime(span.updatedAt)}` : 'SPAN not publishing'}</span>
      {/snippet}
      {#if compact.current}
        <CircuitList pw={panel.powerwall} {span} {rows} {active} />
      {:else}
        <CircuitFlow pw={panel.powerwall} {span} {rows} {active} />
      {/if}
    </Panel>

    <Panel title="Today by circuit">
      {#snippet meta()}<span>since midnight</span>{/snippet}
      {#if today.length}
        <RankedBars rows={today} dense color="var(--home)" />
      {:else}
        <div class="empty">Circuit totals start after the first readings</div>
      {/if}
    </Panel>

    <Panel title="Service">
      {#snippet meta()}<span>{span.serviceRatingA ? `${span.serviceRatingA} A main` : 'main lugs'}</span>{/snippet}
      <div class="service">
        <Stat label="Leg A" value={num(span.currentA, 1)} unit="A" sub={span.voltageA != null ? `${num(span.voltageA, 1)} V` : ''}>
          <Meter value={span.serviceRatingA && span.currentA != null ? (span.currentA / span.serviceRatingA) * 100 : null} tone={legTone(span.currentA)} />
        </Stat>
        <Stat label="Leg B" value={num(span.currentB, 1)} unit="A" sub={span.voltageB != null ? `${num(span.voltageB, 1)} V` : ''}>
          <Meter value={span.serviceRatingA && span.currentB != null ? (span.currentB / span.serviceRatingA) * 100 : null} tone={legTone(span.currentB)} />
        </Stat>
        <Stat label="Frequency" value={num(span.frequencyHz, 2)} unit="Hz" />
        <Stat label="Panel door" value={span.doorClosed == null ? '—' : span.doorClosed ? 'Closed' : 'Open'} />
      </div>
    </Panel>
  </div>
{/if}

<style>
  .single {
    height: 100%;
    display: grid;
  }
  .circuits {
    display: grid;
    grid-template-columns: minmax(0, 2.4fr) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    gap: 1rem;
    height: 100%;
    min-height: 0;
  }
  .circuits > :global(.flow-panel) {
    grid-row: 1 / 3;
  }
  .service {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.9rem 1.2rem;
    padding: 0.2rem 0 0.4rem;
  }

  /* Compact (COMPACT_QUERY): one column; CircuitList replaces the flow
     diagram and sizes itself. */
  @media (max-width: 900px), (max-height: 500px) {
    .circuits {
      display: flex;
      flex-direction: column;
      height: auto;
    }
  }
</style>
