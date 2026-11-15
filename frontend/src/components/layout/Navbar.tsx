'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronRight, CircleDollarSign, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { CashSession } from '@/types';
import { useAuth } from '@/providers/AuthProvider';

export default function Navbar({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const isCashier = user?.role === 'CASHIER';
  const { data: sessionData, isLoading, isError } = useQuery<{ data: CashSession | null }>({
    queryKey: ['activeCashSession', user?._id],
    queryFn: async () => (await api.get('/cash-sessions/current')).data,
    enabled: Boolean(user && isCashier),
  });

  const activeSession = sessionData?.data;
  const currentCash = activeSession?.currentCashBalance ?? activeSession?.openingCash;
  const today = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());

  return (
    <header className="sticky top-0 z-30 flex min-h-20 items-center justify-between gap-4 border-b border-slate-800/80 bg-white/90 px-4 pl-[4.75rem] backdrop-blur-xl sm:px-6 sm:pl-[4.75rem] lg:top-4 lg:mx-4 lg:mt-4 lg:rounded-2xl lg:border lg:px-6 lg:shadow-card">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-extrabold text-ink">Financial Operations</p>
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-700 border border-amber-500/30">
            DEMO MODE · NO REAL MONEY
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <CalendarDays className="h-3.5 w-3.5" />
          <span>{today}</span>
          <span className="hidden sm:inline">· 14-Day Owner Evaluation</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {isCashier && !compact && (
          isLoading ? (
            <div className="hidden h-10 w-44 animate-pulse rounded-xl bg-slate-800 sm:block" aria-label="Loading shift status" />
          ) : activeSession ? (
            <Link href="/cash-sessions" className="hidden items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-2 transition-colors hover:bg-blue-100 sm:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white"><Wallet className="h-4 w-4" /></div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Shift open</p>
                <p className="text-xs font-extrabold text-ink">UGX {Number(currentCash || 0).toLocaleString()}</p>
              </div>
            </Link>
          ) : (
            <Link href="/cash-sessions" className="hidden items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2 text-xs font-bold text-ink hover:bg-brand-50 sm:flex">
              {isError ? 'Check shift' : 'Open shift'} <ChevronRight className="h-4 w-4" />
            </Link>
          )
        )}

        {isCashier && activeSession && !compact && (
          <Link href="/transactions/new" className="hidden min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white shadow-lg shadow-blue-500/20 hover:bg-brand-700 md:flex">
            <CircleDollarSign className="h-4 w-4" /> New Transaction
          </Link>
        )}

        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-white p-1.5 pr-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-black text-white">{user?.name?.charAt(0) || 'M'}</div>
          <div className="hidden text-left sm:block">
            <p className="max-w-28 truncate text-xs font-bold text-ink">{user?.name}</p>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{user?.role}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
