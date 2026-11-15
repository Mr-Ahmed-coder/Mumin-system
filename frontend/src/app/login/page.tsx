'use client';

import { useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { api } from '@/lib/api';
import { ArrowLeftRight, ArrowRight, Building2, Lock, Mail, ShieldCheck, WalletCards } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post('/auth/login', { email, password });
      const { accessToken, user } = res.data.data;
      login(accessToken, user);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#d8e9ff] p-4 sm:p-6 lg:p-10">
      <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-white/60 blur-3xl" />
      <div className="absolute -bottom-28 -right-16 h-80 w-80 rounded-full bg-blue-400/20 blur-3xl" />

      <div className="relative grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_32px_90px_-35px_rgba(39,75,145,0.45)] lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden min-h-[680px] overflow-hidden bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-400 p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-20 -top-16 h-72 w-72 rounded-full border-[42px] border-white/10" />
          <div className="absolute -bottom-24 left-20 h-72 w-72 rounded-full bg-white/10 blur-2xl" />

          <div className="relative flex items-center gap-3">
            <div className="rounded-2xl bg-white/15 p-3 backdrop-blur"><Building2 className="h-7 w-7" /></div>
            <div>
              <p className="text-lg font-black tracking-[0.08em]">MUMIN AGENT</p>
              <p className="text-xs text-blue-50/80">Financial operations workspace</p>
            </div>
          </div>

          <div className="relative max-w-lg">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur">
              <ShieldCheck className="h-4 w-4" /> Secure daily operations
            </span>
            <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight">Manage every shift with clarity and confidence.</h1>
            <p className="mt-4 max-w-md text-sm leading-7 text-blue-50/85">Open the cash drawer, serve customers, reconcile balances, and review activity from one focused workspace.</p>

            <div className="mt-8 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                <WalletCards className="h-6 w-6" />
                <p className="mt-4 text-sm font-bold">Clear balances</p>
                <p className="mt-1 text-xs text-blue-50/75">UGX and USD always stay separate.</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                <ArrowLeftRight className="h-6 w-6" />
                <p className="mt-4 text-sm font-bold">Fast transactions</p>
                <p className="mt-1 text-xs text-blue-50/75">A practical flow for a busy cashier.</p>
              </div>
            </div>
          </div>

          <p className="relative text-xs text-blue-50/70">Cash Exchange Management System</p>
        </section>

        <section className="flex min-h-[620px] items-center px-6 py-10 sm:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-md">
            <div className="mb-10 lg:hidden">
              <div className="inline-flex rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 p-3 text-white shadow-lg shadow-blue-500/20"><Building2 className="h-7 w-7" /></div>
              <h1 className="mt-4 text-xl font-black tracking-[0.06em] text-ink">MUMIN AGENT</h1>
              <p className="mt-1 text-sm text-slate-500">Cash Exchange Management System</p>
            </div>

            <div className="flex items-center gap-2">
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-600">Welcome back</p>
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-700 border border-amber-500/30">
                14-Day Owner Demo
              </span>
            </div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-ink">Sign in to your workspace</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">Evaluation environment with fictional test balances. No real money operations.</p>

            {error && (
              <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-600" role="alert">{error}</div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div>
                <label htmlFor="email" className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-300">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-3.5 h-5 w-5 text-slate-500" />
                  <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3.5 pl-12 pr-4 text-sm text-slate-100 placeholder-slate-600 transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-300">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-3.5 h-5 w-5 text-slate-500" />
                  <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" required autoComplete="current-password" className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3.5 pl-12 pr-4 text-sm text-slate-100 placeholder-slate-600 transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </div>
              </div>

              <button type="submit" disabled={loading} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? 'Authenticating...' : 'Sign In'} <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <div className="mt-8 flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-blue-500" /> Protected role-based access</div>
          </div>
        </section>
      </div>
    </div>
  );
}
