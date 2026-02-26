import './globals.css';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { SignOutButton } from '@/components/SignOutButton';

export const metadata = {
  title: 'Turing Machine Studio',
  description: 'Composite Turing Machines with assignments'
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const role = session?.role;

  return (
    <html lang="el">
      <body>
        <header className="container" style={{ paddingBottom: 0 }}>
          <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="row" style={{ alignItems: 'center' }}>
              <Link href="/" className="button primary">TM Studio</Link>
              {session ? (
                <>
                  <Link href="/dashboard" className="button">Dashboard</Link>
                  {(role === 'TEACHER' || role === 'ADMIN') && <Link href="/teacher" className="button">Teacher</Link>}
                  {role === 'ADMIN' && <Link href="/admin" className="button">Admin</Link>}
                </>
              ) : (
                <>
                  <Link href="/login" className="button">Login</Link>
                  <Link href="/register" className="button">Register</Link>
                </>
              )}
            </div>
            <div className="row" style={{ alignItems: 'center' }}>
              {session ? (
                <>
                  <span className="badge">{session.user?.email}</span>
                  <span className="badge">{role}</span>
                  <SignOutButton />
                </>
              ) : (
                <span className="small">No email verification</span>
              )}
            </div>
          </div>
          <hr />
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
