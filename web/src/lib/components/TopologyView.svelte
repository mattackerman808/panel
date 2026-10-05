<script lang="ts">
  import ELK from 'elkjs/lib/elk.bundled.js';
  import { panel } from '$lib/store.svelte';
  import { buildTopology, type Topology, type TopoEdge } from '$lib/topology';
  import { bps, shortName, speedLabel } from '$lib/format';
  import { deviceTypeLabel } from '$lib/derive';

  /** LLDP topology, laid out top-down by elkjs. Layout runs only when the
   *  structure changes; rates and link utilization restyle every tick.
   *  Link width and color encode utilization of the negotiated speed. */
  const NODE_W = 196;
  const NODE_H = 58;
  const EDGE_MIN_PX = 1.5;
  const EDGE_MAX_PX = 9;

  const elk = new ELK();

  type LaidNode = { x: number; y: number };
  type LaidEdge = { points: Array<{ x: number; y: number }>; labelXY?: { x: number; y: number } };
  type Layout = { width: number; height: number; nodes: Map<string, LaidNode>; edges: Map<string, LaidEdge> };

  const topology = $derived<Topology>(buildTopology(panel.devices, panel.wans));
  let layout = $state<Layout | null>(null);

  const structureSig = $derived(
    topology.nodes.map((n) => n.id).sort().join(',') + '|' + topology.edges.map((e) => `${e.id}:${e.capacityBps}`).sort().join(','),
  );
  let lastSig = '';

  $effect(() => {
    const sig = structureSig;
    if (sig === lastSig) return;
    lastSig = sig;
    void runLayout(topology);
  });

  async function runLayout(t: Topology): Promise<void> {
    if (t.nodes.length === 0) {
      layout = null;
      return;
    }
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        // Left-to-right: the WAN → gateway → aggregation → leaf chain reads
        // across a 16:9 panel, and a dozen leaf devices stack vertically
        // instead of squeezing into one wide row.
        'elk.direction': 'RIGHT',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.spacing.nodeNode': '18',
        'elk.layered.spacing.nodeNodeBetweenLayers': '110',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.crossingMinimization.semiInteractive': 'true',
      },
      children: t.nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
      edges: t.edges.map((e) => ({ id: e.id, sources: [e.sourceId], targets: [e.targetId] })),
    } as const;
    const result = await elk.layout(graph as Parameters<typeof elk.layout>[0]);
    const nodeMap = new Map<string, LaidNode>();
    for (const n of result.children ?? []) nodeMap.set(n.id!, { x: n.x ?? 0, y: n.y ?? 0 });
    const edgeMap = new Map<string, LaidEdge>();
    for (const e of result.edges ?? []) {
      const sec = e.sections?.[0];
      if (!sec) continue;
      const points = [
        { x: sec.startPoint.x, y: sec.startPoint.y },
        ...(sec.bendPoints ?? []).map((p) => ({ x: p.x, y: p.y })),
        { x: sec.endPoint.x, y: sec.endPoint.y },
      ];
      // Label on the longest segment running in the layout direction so it
      // doesn't sit on a shared bus line.
      let bestLen = -1;
      let labelXY = { x: points[0]!.x, y: points[0]!.y };
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const horizontal = Math.abs(b.y - a.y) < 0.5;
        const len = Math.hypot(b.x - a.x, b.y - a.y) * (horizontal ? 1.5 : 1);
        if (len > bestLen) {
          bestLen = len;
          labelXY = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }
      }
      edgeMap.set(e.id!, { points, labelXY });
    }
    layout = { width: result.width ?? 0, height: result.height ?? 0, nodes: nodeMap, edges: edgeMap };
  }

  function pathFromPoints(pts: Array<{ x: number; y: number }>): string {
    if (pts.length === 0) return '';
    let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i]!.x} ${pts[i]!.y}`;
    return d;
  }

  function edgeThickness(e: TopoEdge): number {
    return EDGE_MIN_PX + (EDGE_MAX_PX - EDGE_MIN_PX) * Math.sqrt(e.utilization);
  }

  function edgeColor(e: TopoEdge): string {
    if (e.rateBps <= 0) return 'var(--line-strong)';
    if (e.utilization >= 0.95) return 'var(--crit)';
    if (e.utilization >= 0.8) return 'var(--warn)';
    return 'var(--rx)';
  }

  function edgeLabel(e: TopoEdge): string {
    if (e.rateBps <= 0) return 'idle';
    return bps(e.rateBps / 8);
  }
</script>

<div class="topo">
  {#if !layout || layout.nodes.size === 0}
    <div class="empty">Building topology…</div>
  {:else}
    <svg class="topo-svg" viewBox="-12 -12 {layout.width + 24} {layout.height + 24}" preserveAspectRatio="xMidYMid meet">
      {#each topology.edges as edge (edge.id)}
        {@const laid = layout.edges.get(edge.id)}
        {#if laid}
          <g class="edge">
            <path d={pathFromPoints(laid.points)} fill="none" stroke={edgeColor(edge)} stroke-width={edgeThickness(edge)} stroke-linecap="round" stroke-linejoin="round" opacity={edge.rateBps <= 0 ? 0.6 : 0.9} />
            {#if laid.labelXY}
              <g transform="translate({laid.labelXY.x},{laid.labelXY.y})">
                <rect x="-34" y="-10" width="68" height="20" rx="4" fill="var(--bg)" stroke="var(--line)" />
                <text text-anchor="middle" dominant-baseline="central" class="edge-label" class:idle={edge.rateBps <= 0}>{edgeLabel(edge)}</text>
              </g>
            {/if}
          </g>
        {/if}
      {/each}

      {#each topology.nodes as node (node.id)}
        {@const pos = layout.nodes.get(node.id)}
        {#if pos}
          <g class="node" transform="translate({pos.x},{pos.y})">
            {#if node.kind === 'wan'}
              {@const w = node.wan}
              <rect width={NODE_W} height={NODE_H} rx="8" fill="var(--surface-2)" stroke="var(--line-strong)" />
              <rect x="0" y="0" width="4" height={NODE_H} rx="2" fill="var(--tx)" />
              <text x="14" y="21" class="name">{w.label}</text>
              <text x="14" y="39" class="meta">WAN · {w.ispName ?? w.ifName}{w.speedBitsPerSec > 0 ? ` · ${speedLabel(w.speedBitsPerSec / 1e6)}` : ''}</text>
              <text x={NODE_W - 12} y="39" text-anchor="end" class="rate">↓ {bps(w.rxBps)}</text>
              <circle cx={NODE_W - 12} cy="14" r="4" fill={w.status === 'ok' ? 'var(--ok)' : w.status === 'degraded' ? 'var(--warn)' : 'var(--crit)'} />
            {:else}
              {@const d = node.device}
              {@const up = d.state === 1}
              <rect width={NODE_W} height={NODE_H} rx="8" fill="var(--surface-2)" stroke={up ? 'var(--line-strong)' : 'var(--crit)'} />
              <rect x="0" y="0" width="4" height={NODE_H} rx="2" fill={d.type === 'udm' ? 'var(--accent)' : d.type === 'uap' ? 'var(--ok)' : 'var(--rx)'} opacity={up ? 1 : 0.4} />
              <text x="14" y="21" class="name">{shortName(d.name)}</text>
              <text x="14" y="39" class="meta">{deviceTypeLabel(d.type)} · {d.modelName}</text>
              <text x={NODE_W - 12} y="39" text-anchor="end" class="rate">{d.type === 'uap' ? `${d.numClients} cl · ` : ''}{bps(d.bytesRate)}</text>
              <circle cx={NODE_W - 12} cy="14" r="4" fill={up ? 'var(--ok)' : 'var(--crit)'} />
            {/if}
          </g>
        {/if}
      {/each}
    </svg>
  {/if}
</div>

<style>
  .topo {
    height: 100%;
    width: 100%;
    overflow: hidden;
  }
  .topo-svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .edge path {
    transition: stroke-width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .edge-label {
    font-family: var(--font-mono);
    font-size: 10px;
    fill: var(--ink-2);
  }
  .edge-label.idle {
    fill: var(--ink-3);
  }
  .name {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
    fill: var(--ink);
  }
  .meta {
    font-family: var(--font-ui);
    font-size: 10px;
    letter-spacing: 0.04em;
    fill: var(--ink-3);
  }
  .rate {
    font-family: var(--font-mono);
    font-size: 10px;
    fill: var(--ink-2);
  }
</style>
