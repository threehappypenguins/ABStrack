import { IconChevronDown } from './IconChevronDown';

type DisclosureChevronProps = {
  /** Extra classes on the outer control (e.g. alignment). */
  className?: string;
};

/**
 * Visual expand/collapse affordance for native `<details class="group">` summaries.
 * Decorative only — the `<summary>` element carries the accessible name.
 */
export function DisclosureChevron({ className = '' }: DisclosureChevronProps) {
  return (
    <span
      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-app-border/80 bg-app-bg/60 text-app-muted ${className}`.trim()}
      aria-hidden
    >
      <IconChevronDown className="h-5 w-5 transition-transform duration-200 group-open:rotate-180" />
    </span>
  );
}
