'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    router.replace(user.role === 'driver' ? '/driver' : '/passenger');
  }, [user, loading, router]);

  if (loading) return null;
  if (user) return null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-4 py-16">
      <p className="mb-2 text-sm uppercase tracking-wide text-ink/50">Banani · Gulshan · Mohakhali</p>
      <h1 className="mb-4 font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl">
        Share a seat.
        <br />
        Split the fare.
        <br />
        Survive Dhaka traffic.
      </h1>
      <p className="mb-8 max-w-md text-ink/70">
        Request a Tesla, pool with someone headed your way, and see exactly what you owe before you get in.
      </p>
      <div className="flex gap-3">
        <Link href="/login" className="btn-primary">
          Sign in
        </Link>
        <Link href="/signup" className="btn-secondary">
          Create an account
        </Link>
      </div>
    </main>
  );
}
