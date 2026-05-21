import { PUBLIC_MAIN_CLASS } from '@/components/app-shell/public-page-layout-classes';

/**
 * Single primary landmark for marketing and auth flows. Authenticated app routes use
 * {@link AuthenticatedShell}’s `<main id="main-content">` instead — the root layout must not wrap
 * all children in `<main>` or nested mains break axe.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main id="main-content" className={PUBLIC_MAIN_CLASS}>
      {children}
    </main>
  );
}
