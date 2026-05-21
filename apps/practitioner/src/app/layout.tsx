import './global.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Script from 'next/script';
import { PractitionerAppShell } from '../components/app-shell/PractitionerAppShell';
import { PractitionerPublicTopNav } from '../components/app-shell/PractitionerPublicTopNav';
import { LiveAnnouncerRoot } from '../components/a11y/LiveAnnouncerRoot';
import { ThemeProvider } from '../components/theme/ThemeProvider';
import { AuthProvider } from '../lib/auth-provider';
import { THEME_INIT_SCRIPT } from '../lib/theme-init-script';

const fontSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-app-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ABStrack Practitioner',
  description:
    'Practitioner access for ABStrack patient support and care workflows',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontSans.variable} suppressHydrationWarning>
      <body className={`${fontSans.className} antialiased`}>
        <Script
          id="abstrack-practitioner-theme-init"
          strategy="beforeInteractive"
        >
          {THEME_INIT_SCRIPT}
        </Script>
        <ThemeProvider>
          <AuthProvider>
            <LiveAnnouncerRoot>
              <PractitionerPublicTopNav />
              <PractitionerAppShell>{children}</PractitionerAppShell>
            </LiveAnnouncerRoot>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
