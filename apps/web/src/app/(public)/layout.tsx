import { WebPublicTopNav } from '@/components/app-shell/WebPublicTopNav';

/**
 * Single primary landmark for marketing and auth flows. Authenticated app routes under
 * `(app)/` use {@link AuthenticatedShell}’s `<main id="main-content">` instead — the root
 * layout must not wrap all children in `<main>` or nested mains break axe.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <WebPublicTopNav />
      <main id="main-content">{children}</main>
    </>
  );
}
