/**
 * Route-level or inline loading affordance for data-driven pages (e.g. `loading.tsx`).
 *
 * @param props - Props.
 * @param props.title - Accessible name for the loading region.
 * @returns Loading section.
 */
export function PageLoading({ title }: { title: string }) {
  return (
    <section
      className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]"
      aria-busy="true"
      aria-label={title}
    >
      <div className="flex items-center gap-3">
        <div
          className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-app-primary border-t-transparent"
          aria-hidden
        />
        <p className="text-sm font-medium text-app-muted">Loading…</p>
      </div>
    </section>
  );
}
