<script lang="ts">
  /** Inline trend line. Sized by its container width; the last point gets an
   *  end marker with a surface ring so it stays legible over the area fill. */
  type Props = {
    values: Array<number | null>;
    color?: string;
    height?: number;
    fill?: boolean;
    /** Pin the scale (e.g. 0–100 for percentages). */
    min?: number | null;
    max?: number | null;
    class?: string;
  };
  let { values, color = 'var(--rx)', height = 28, fill = true, min = null, max = null, class: cls = '' }: Props = $props();

  let width = $state(0);

  const geom = $derived.by(() => {
    const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
    if (xs.length < 2 || width <= 8) return null;
    let lo = min ?? Math.min(...xs);
    let hi = max ?? Math.max(...xs);
    if (min === null && max === null && hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const range = hi - lo || 1;
    const pad = 3;
    const w = width;
    const h = height;
    const pts = xs.map((v, i) => [pad + (i / (xs.length - 1)) * (w - pad * 2), h - pad - ((v - lo) / range) * (h - pad * 2)] as const);
    let line = '';
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i]!;
      line += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    const area = `${line}L${last[0].toFixed(1)} ${h}L${first[0].toFixed(1)} ${h}Z`;
    return { line, area, last };
  });
</script>

<div class="spark {cls}" bind:clientWidth={width} style="height: {height}px">
  {#if geom}
    <svg {width} {height} aria-hidden="true">
      {#if fill}
        <path d={geom.area} fill={color} opacity="0.13" />
      {/if}
      <path d={geom.line} fill="none" stroke={color} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={geom.last[0]} cy={geom.last[1]} r="3" fill={color} stroke="var(--surface)" stroke-width="2" />
    </svg>
  {/if}
</div>

<style>
  .spark {
    width: 100%;
    min-width: 0;
    overflow: hidden;
  }
  svg {
    display: block;
  }
</style>
