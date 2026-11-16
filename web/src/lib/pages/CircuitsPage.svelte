<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { deriveFlow } from '$lib/derive';
  import { kwh, num, relativeTime, watts } from '$lib/format';
  import type { RankedRow } from '$lib/ui';
  import Panel from '$lib/components/Panel.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import Meter from '$lib/components/Meter.svelte';
  import RankedBars from '$lib/components/RankedBars.svelte';
  import EnergySankey from '$lib/components/EnergySankey.svelte';

  /** The whole house in one picture: where the power comes from (solar,
   *  Powerwall, grid) and which SPAN circuits it goes to, plus every
   *  circuit ranked and the electrical service at the main lugs. */
  let { active = true }: { active?: boolean } = $props();

  const span = $derived(panel.span);
  const configured = $derived(panel.features.spanAvailable);
  const live = $derived(!!span && span.reachable);
  const flow = $derived(deriveFlow(panel.powerwall, span));
  const loads = $derived((span?.circuits ?? []).filter((c) => !c.source));
  const rows = $derived<RankedRow[]>(
    loads
      .slice()
      .sort((a, b) => b.powerW - a.powerW)
      .map((c) => ({
        id: c.id,
        label: c.name,
        sub: [c.todayWh != null ? `${kwh(c.todayWh)} today` : null, c.ratingA ? `${c.ratingA} A` : null, c.relay === 'OPEN' ? 'off' : null]
          .filter(Boolean)
          .join(' · '),
        value: Math.max(0, c.powerW),
        text: watts(Math.max(0, c.powerW)),
      })),
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
    <Panel title="Where the power goes" tone={live ? 'none' : 'warn'} class="flow-panel">
      {#snippet meta()}
        <span>sources → panel → circuits</span>
        <span>{live ? `updated ${relativeTime(span.updatedAt)}` : 'SPAN not publishing'}</span>
      {/snippet}
      {#if flow}
        <EnergySankey {flow} busLabel="SPAN panel" />
      {:else}
        <div class="empty">No power readings yet</div>
      {/if}
    </Panel>

    <Panel title="Circuits">
      {#snippet meta()}<span>{loads.length} circuits · live draw</span>{/snippet}
      <RankedBars {rows} dense color="var(--home)" />
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
    grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr);
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
</style>
