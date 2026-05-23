import './global.css';
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Script from 'next/script';
import { ThemeProvider } from '../components/theme/ThemeProvider';
import { THEME_INIT_SCRIPT } from '../lib/theme-init-script';
import { WebAppShell } from '../components/app-shell/WebAppShell';
import { WebPublicTopNav } from '../components/app-shell/WebPublicTopNav';
import { LiveAnnouncerRoot } from '../components/a11y/LiveAnnouncerRoot';
import { isAuthSessionMissingError } from '@abstrack/supabase';
import { AuthProvider } from '../lib/auth-provider';
import { mapSupabaseUserToAuthContext } from '../lib/auth-provider-session';
import { createServerClient } from '../lib/supabase/server-client';

const fontSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-app-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ABStrack',
  description: 'Patient management application',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser();

  if (getUserError && !isAuthSessionMissingError(getUserError)) {
    console.error(
      'Failed to verify user for root layout; deferring session to client',
      getUserError,
    );
  }

  const initialSession =
    getUserError && !isAuthSessionMissingError(getUserError)
      ? undefined
      : mapSupabaseUserToAuthContext(user);

  return (
    <html lang="en" className={fontSans.variable} suppressHydrationWarning>
      <body className={`${fontSans.className} antialiased`}>
        <Script id="abstrack-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <ThemeProvider>
          <AuthProvider initialSession={initialSession}>
            <LiveAnnouncerRoot>
              <WebPublicTopNav />
              <WebAppShell>{children}</WebAppShell>
            </LiveAnnouncerRoot>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
