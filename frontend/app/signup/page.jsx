'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { ApiRequestError } from '../../lib/api';

export default function SignupPage() {
  const { signup } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', role: 'passenger' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await signup(form);
      router.push(user.role === 'driver' ? '/driver' : '/passenger');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-16">
      <h1 className="mb-8 font-display text-3xl font-bold">Create an account</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="field-label" htmlFor="name">
            Name
          </label>
          <input id="name" required value={form.name} onChange={update('name')} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={update('email')}
            className="field-input"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="phone">
            Phone (optional)
          </label>
          <input id="phone" value={form.phone} onChange={update('phone')} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={update('password')}
            className="field-input"
          />
        </div>
        <div>
          <span className="field-label">I want to</span>
          <div className="flex gap-2">
            {[
              { value: 'passenger', label: 'Book rides' },
              { value: 'driver', label: 'Drive a Tesla' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, role: opt.value }))}
                className={`flex-1 rounded-sm border px-3 py-2 text-sm font-medium transition-colors ${
                  form.role === opt.value
                    ? 'border-rickshaw bg-rickshaw/5 text-rickshaw-dark'
                    : 'border-line text-ink/70 hover:border-ink/40'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-sm border border-rickshaw/30 bg-rickshaw/5 px-3 py-2 text-sm text-rickshaw-dark">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink/60">
        Already have an account?{' '}
        <Link href="/login" className="text-ink underline decoration-line underline-offset-4">
          Sign in
        </Link>
      </p>
    </main>
  );
}
