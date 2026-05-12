import { NextResponse } from 'next/server';

const DEFAULT_IOS_BUNDLE_ID = 'com.abstrack.mobile';

/**
 * Serves Apple’s Universal Links association file for the user web host so iOS can open
 * `https://…/auth/callback` in the native app when installed (not `/caretaker/join`, which has no
 * `code` after the web exchange).
 *
 * Configure **`APPLE_APP_SITE_ASSOCIATION_TEAM_ID`** (10-character Apple Developer Team ID) on
 * the deployment that serves this host. Omit or leave unset to return **404** until configured.
 *
 * @see https://developer.apple.com/documentation/xcode/supporting-associated-domains
 * @returns JSON association payload, or **404** when Team ID is not configured.
 */
export function GET() {
  const teamId = process.env.APPLE_APP_SITE_ASSOCIATION_TEAM_ID?.trim();
  if (!teamId) {
    return new NextResponse(null, { status: 404 });
  }

  const bundleId =
    process.env.APPLE_IOS_BUNDLE_ID?.trim() || DEFAULT_IOS_BUNDLE_ID;
  const appId = `${teamId}.${bundleId}`;

  const body = {
    applinks: {
      apps: [] as string[],
      details: [
        {
          appID: appId,
          paths: ['/auth/callback*'],
        },
      ],
    },
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
