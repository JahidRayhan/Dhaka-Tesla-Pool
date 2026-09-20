import { Big_Shoulders_Display, Public_Sans } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '../lib/AuthContext';

const display = Big_Shoulders_Display({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
});

const body = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
});

export const metadata = {
  title: 'Dhaka Tesla Pool',
  description: 'Share a seat. Split the fare. Survive Dhaka traffic.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
