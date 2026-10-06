<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import TopologyView from '$lib/components/TopologyView.svelte';

  let { active = true }: { active?: boolean } = $props();

  const linked = $derived(panel.devices.filter((d) => d.uplink || d.ports.some((p) => p.neighbor)).length);
</script>

<div class="topology" data-active={active}>
  <Panel title="Topology" flush>
    {#snippet meta()}
      <span><strong>{linked}</strong> of {panel.devices.length} devices linked via LLDP</span>
      <span>Link width and color = utilization</span>
    {/snippet}
    <div class="canvas">
      <TopologyView />
    </div>
  </Panel>
</div>

<style>
  .topology {
    height: 100%;
    min-height: 0;
    display: grid;
  }
  .canvas {
    height: 100%;
    min-height: 0;
    padding: 0.5rem 1rem 1rem;
  }
</style>
