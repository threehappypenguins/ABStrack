import { LANDING_PAGE_METADATA, buildLandingJsonLd } from '@/lib/site-seo';
import { LandingAuthGate } from './LandingAuthGate';
import { LandingPageStatic } from './LandingPageStatic';

export { LANDING_PAGE_METADATA as metadata };

/**
 * Public landing / marketing route at `/`. Authenticated users are redirected to the
 * dashboard from {@link LandingAuthGate}.
 *
 * @returns Landing page with JSON-LD and server-rendered marketing copy.
 */
export default function IndexPage() {
  const jsonLd = buildLandingJsonLd();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingAuthGate>
        <LandingPageStatic />
      </LandingAuthGate>
    </>
  );
}
