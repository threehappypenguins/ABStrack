import './global.css';
import { AuthProvider } from '../lib/auth-provider';

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
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
