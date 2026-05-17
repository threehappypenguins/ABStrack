/** Shared `<summary>` styles for practitioner `<details>` disclosures (marker hidden; focus ring). */
export const PRACTITIONER_DETAILS_SUMMARY_CLASS =
  'flex w-full cursor-pointer list-none items-start gap-3 text-left transition-colors hover:bg-app-muted/5 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg';

/** Wrap summary primary copy (title + metadata) beside {@link DisclosureChevron}. */
export const PRACTITIONER_DETAILS_SUMMARY_BODY_CLASS =
  'min-w-0 flex-1 flex flex-col items-start gap-1';
