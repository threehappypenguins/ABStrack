import type { SVGProps } from 'react';

type IconChevronDownProps = SVGProps<SVGSVGElement>;

/**
 * Downward chevron for disclosure controls; pair with `group-open:rotate-180` on a parent `<details class="group">`.
 *
 * @param props - SVG attributes; pass `className` for size/color/rotation.
 */
export function IconChevronDown(props: IconChevronDownProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
