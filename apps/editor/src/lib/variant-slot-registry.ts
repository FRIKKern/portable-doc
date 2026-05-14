/**
 * Module-scoped registry that lets the editor's React tree know about the
 * variant-chip DOM slots that A2's NodeViews paint into.
 *
 * Why this exists
 * ---------------
 * A5's original implementation used `react-dom/client`'s `createRoot` inside
 * each NodeView to mount `<VariantChip>` into the chrome's variant slot.
 * That pattern is incompatible with React 18 StrictMode + @tiptap/react's
 * `useSyncExternalStore`: a single click into the editor produced ~7,500
 * child mutations and ~2,660 attribute mutations per second, the cursor
 * froze, and toolbars never had time to paint. The cycle was
 *
 *   chip renders into slot → MutationObserver in ProseMirror's view sees
 *   the DOM change → NodeView is destroyed and recreated → chip's React
 *   root is unmounted (sync, during render) → new NodeView mounts a new
 *   React root → chip renders into the new slot → loop.
 *
 * The fix is to keep chip rendering in the editor's *stable* React tree
 * (Editor.tsx) and use `createPortal` to project it into each slot. Roots
 * live and die with the editor, not with each NodeView swap.
 *
 * Contract
 * --------
 *   - NodeViews call `registerSlot(slot, props)` on create and on each
 *     `update()` (to refresh attrs). They call `unregisterSlot(slot)` in
 *     `destroy()`.
 *   - Editor.tsx subscribes via `useSyncExternalStore(subscribeSlots,
 *     getSnapshot)` and renders `createPortal(<VariantChip />, slot)` for
 *     each entry.
 *   - `getSnapshot` returns a cached array reference that only changes
 *     when slots are added/removed/updated — keeps React happy.
 *
 * Only one editor instance is expected per app (this v0.4 surface). The
 * module-scoped state is acceptable for that scope; a v0.5 multi-editor
 * setup would need this scoped to an editor instance via React context.
 */

export interface VariantChipSlotProps {
  /** PortableDoc block type name (callout/action/section/code). */
  blockType: string;
  /** Block attrs object — passed through to `<VariantChip>`'s `attrs`. */
  attrs: Record<string, unknown>;
  /** Fires when the writer picks a variant; the NodeView translates this
   *  into the matching TipTap command. */
  onChange: (next: Record<string, string>) => void;
}

export interface VariantChipSlotEntry {
  /** A stable id we generate at register-time so React can key portals
   *  without relying on the array index (which shifts when middle items
   *  are removed). */
  id: string;
  /** The DOM node a portal should render into. */
  slot: HTMLElement;
  /** Chip props. */
  props: VariantChipSlotProps;
}

const entries = new Map<HTMLElement, VariantChipSlotEntry>();
const listeners = new Set<() => void>();
let snapshot: VariantChipSlotEntry[] = [];
let nextId = 1;

function rebuildSnapshot(): void {
  snapshot = Array.from(entries.values());
}

function notify(): void {
  rebuildSnapshot();
  for (const l of listeners) l();
}

export function registerSlot(slot: HTMLElement, props: VariantChipSlotProps): void {
  const existing = entries.get(slot);
  if (existing) {
    // Cheap shallow equality on attrs to avoid notifying when nothing
    // changed (the NodeView calls this from `update()` on every TX).
    if (
      existing.props.blockType === props.blockType &&
      existing.props.onChange === props.onChange &&
      shallowEqualAttrs(existing.props.attrs, props.attrs)
    ) {
      return;
    }
    entries.set(slot, { ...existing, props });
  } else {
    const id = `vchip-${nextId++}`;
    entries.set(slot, { id, slot, props });
  }
  notify();
}

export function unregisterSlot(slot: HTMLElement): void {
  if (!entries.has(slot)) return;
  entries.delete(slot);
  notify();
}

export function subscribeSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): VariantChipSlotEntry[] {
  return snapshot;
}

function shallowEqualAttrs(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) {
    // `variant` is an object — compare its inner keys too. Other attrs are
    // primitives so direct === is fine.
    if (k === 'variant') {
      const av = a[k] as Record<string, string> | null | undefined;
      const bv = b[k] as Record<string, string> | null | undefined;
      if (!av && !bv) continue;
      if (!av || !bv) return false;
      const avk = Object.keys(av);
      if (avk.length !== Object.keys(bv).length) return false;
      for (const ik of avk) if (av[ik] !== bv[ik]) return false;
      continue;
    }
    if (a[k] !== b[k]) return false;
  }
  return true;
}
