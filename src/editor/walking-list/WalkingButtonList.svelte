<script lang="ts">
  import type { MovementRow } from "./types";

  export let rows: MovementRow[] = [];
  export let onSelect: (row: MovementRow) => void = () => {};
</script>

{#each rows as row (`${row.sourceId}:${row.targetId}`)}
  <button
    class={`editor-saved-movement${row.selected ? " is-selected" : ""}${row.positioned ? "" : " is-pending"}`}
    type="button"
    data-saved-movement-source={row.sourceId}
    data-saved-movement-target={row.targetId}
    data-saved-movement-index={row.hotspotIndex}
    aria-label={`Select movement to ${row.title}`}
    on:click={() => onSelect(row)}
  >
    <span class="editor-saved-movement__thumb">
      {#if row.thumbnail}
        <img src={row.thumbnail} alt="" loading="lazy" decoding="async" />
      {/if}
      <i aria-hidden="true">
        <svg class="editor-walking-icon" viewBox="0 0 24 24" focusable="false">
          <path d="M12.2 4.2a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z" />
          <path d="m11.6 9.1-2.3 3.7 3 2.1-.8 4.5" />
          <path d="m12.7 10.3 2 2.1 2.6.6" />
          <path d="m9.2 12.8-2.5 1.7" />
          <path d="m12.3 14.9 3.2 4.2" />
        </svg>
      </i>
    </span>
    <span class="editor-saved-movement__copy">
      <strong>{row.title}</strong>
      {#if row.subtitle}
        <em>{row.subtitle}</em>
      {/if}
    </span>
    <small>{row.status}</small>
  </button>
{/each}
