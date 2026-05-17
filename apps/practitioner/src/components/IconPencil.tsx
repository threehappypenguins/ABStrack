import type { SVGProps } from 'react';

type IconPencilProps = SVGProps<SVGSVGElement>;

/**
 * Pencil / edit icon (stroke style, 24×24 viewBox).
 *
 * @param props - SVG attributes; pass `className` for size/color.
 */
export function IconPencil(props: IconPencilProps) {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
