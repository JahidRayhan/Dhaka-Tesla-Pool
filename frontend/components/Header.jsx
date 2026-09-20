'use client';

import Link from 'next/link';
import { useAuth } from '../lib/AuthContext';

export default function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Link href="/" className="font-display text-xl font-bold tracking-tight">
          Dhaka Tesla Pool
        </Link>
        {user && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-ink/70">{user.name}</span>
            <button onClick={logout} className="text-ink/70 underline decoration-line underline-offset-4 hover:text-ink">
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
