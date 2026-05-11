import { NextResponse } from 'next/server';

const DEFAULT_PACKAGE_NAME = 'com.abstrack.mobile';

function parseSha256List(raw: string | undefined): string[] {
  if (raw == null || raw.trim() === '') {
    return [];
  }
  return raw
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Serves Android App Links Digital Asset Links JSON so Android can open matching `https://…`
 * URLs in the native app when installed.
 *
 * Set **`ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS`** to one or more SHA-256 certificate
 * fingerprints (colon-separated hex, one per line or comma-separated): Play App Signing cert,
 * and your **debug** keystore fingerprint for local builds. **`ANDROID_APPLICATION_ID`** defaults
 * to `com.abstrack.mobile`. Returns **404** until at least one fingerprint is configured.
 *
 * @see https://developer.android.com/training/app-links/configure-asset-links
 * @returns Digital Asset Links JSON array, or **404** when no fingerprints are configured.
 */
export function GET() {
  const fingerprints = parseSha256List(
    process.env.ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS,
  );
  if (fingerprints.length === 0) {
    return new NextResponse(null, { status: 404 });
  }

  const packageName =
    process.env.ANDROID_APPLICATION_ID?.trim() || DEFAULT_PACKAGE_NAME;

  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return NextResponse.json(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
