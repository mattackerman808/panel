<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    title: string;
    /** Status dot before the title; omit for neutral panels. */
    tone?: 'ok' | 'warn' | 'crit' | 'off' | 'none';
    /** Right-aligned header content (counts, window, legend). */
    meta?: Snippet;
    children: Snippet;
    /** Drop the body padding (for edge-to-edge tables/canvases). */
    flush?: boolean;
    class?: string;
    style?: string;
  };
  let { title, tone = 'none', meta, children, flush = false, class: cls = '', style = '' }: Props = $props();
</script>

<section class="panel {cls}" {style}>
  <header>
    <h2>
      {#if tone !== 'none'}<span class="dot {tone}"></span>{/if}
      {title}
    </h2>
    {#if meta}
      <div class="panel-meta">{@render meta()}</div>
    {/if}
  </header>
  <div class="body" class:flush>
    {@render children()}
  </div>
</section>
