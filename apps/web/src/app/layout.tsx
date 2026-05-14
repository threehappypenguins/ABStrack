import './global.css';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Script from 'next/script';
import { ThemeProvider } from '../components/theme/ThemeProvider';
import { THEME_INIT_SCRIPT } from '../lib/theme-init-script';
import { LiveAnnouncerRoot } from '../components/a11y/LiveAnnouncerRoot';
import { AuthProvider } from '../lib/auth-provider';

const fontSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-app-sans',
  display: 'swap',
});

export const metadata = {
  title: 'ABStrack',
  description: 'Patient management application',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fontSans.variable} suppressHydrationWarning>
      <body className={`${fontSans.className} antialiased`}>
        <Script id="abstrack-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <ThemeProvider>
          <AuthProvider>
            <LiveAnnouncerRoot>{children}</LiveAnnouncerRoot>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
