'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import Link from 'next/link';

type Account = { id: string; name: string; kind: 'CASH' | 'WALLET'; currency: 'USD' | 'UGX' };

export default function ExpandedOpeningForm({ close, onOpened }: { close: () => void; onOpened: () => void }) {
  const { user } = useAuth();
  const [amounts, setAmounts] = useState<Record<string, string>>({ CASH_USD: '', CASH_UGX: '' });
  const [review, setReview] = useState(false);
  const [reviewedRateId, setReviewedRateId] = useState('');
  const catalog = useQuery<Account[]>({ queryKey: ['openingAccounts', user?._id],
    queryFn: async () => (await api.get('/cash-sessions/opening-accounts')).data.data });
  const rate = useQuery<{ _id: string; rate: number } | null>({ queryKey: ['openingExchangeRate', user?._id],
    queryFn: async () => (await api.get('/exchange-rates/active')).data.data });
  const selected = (catalog.data || []).filter(a => amounts[a.id] !== undefined);
  const valid = selected.length >= 2 && selected.every(a => amounts[a.id] !== '' &&
    Number.isFinite(Number(amounts[a.id])) && Number(amounts[a.id]) >= 0 &&
    (a.currency === 'UGX' ? Number.isSafeInteger(Number(amounts[a.id])) :
      Math.abs(Number(amounts[a.id]) * 100 - Math.round(Number(amounts[a.id]) * 100)) < 0.000001));
  const opening = useMutation({ mutationFn: async () => api.post('/cash-sessions/open-accounts', {
    accounts: selected.map(a => ({ accountId: a.id, amount: Number(amounts[a.id]) })), exchangeRateId: reviewedRateId,
  }), onSuccess: onOpened });

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-labelledby="opening-title" className="max-h-[92vh] w-full max-w-2xl space-y-5 overflow-y-auto rounded-2xl border border-blue-100 bg-white p-5 shadow-xl sm:p-7">
      <div className="flex items-center justify-between gap-4"><h2 id="opening-title" className="text-xl font-bold text-[#162447]">{review ? 'Review & Confirm' : 'Open Shift'}</h2><button disabled={opening.isPending} onClick={close} aria-label="Close opening form" className="min-h-11 rounded-xl px-3 text-[#6B7A99]">Close</button></div>
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Use test balances only. Closing requires verified account movements.</p>
      {catalog.isLoading || rate.isLoading ? <p role="status">Loading accounts and rate…</p> : catalog.isError || rate.isError ?
        <div role="alert">Unable to load opening information. <button onClick={() => { catalog.refetch(); rate.refetch(); }} className="min-h-11 px-3 text-blue-700 underline">Retry</button></div> : <>
        {(['CASH', 'WALLET'] as const).map(kind => <section key={kind} className="space-y-3"><h3 className="font-bold text-[#162447]">{kind === 'CASH' ? '1. Cash Balances' : '2. Wallet Balances'}</h3>
          <div className="grid gap-3 sm:grid-cols-2">{(catalog.data || []).filter(a => a.kind === kind).map(a => <div key={a.id} className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
            <label className="flex min-h-8 items-center gap-2 text-sm font-semibold text-[#162447]">
              {kind === 'WALLET' && !review && <input type="checkbox" checked={amounts[a.id] !== undefined} onChange={e => setAmounts(current => {
                const next = { ...current }; if (e.target.checked) next[a.id] = ''; else delete next[a.id]; return next;
              })} />}{a.name} ({a.currency})
            </label>
            {amounts[a.id] !== undefined ? review ? <p className="mt-2 font-bold text-[#162447]">{a.currency} {Number(amounts[a.id]).toLocaleString()}</p> :
              <input aria-label={`${a.name} opening balance (${a.currency})`} type="number" min="0" step={a.currency === 'UGX' ? '1' : '0.01'} required value={amounts[a.id]} onChange={e => setAmounts({ ...amounts, [a.id]: e.target.value })} className="mt-2 w-full rounded-xl border border-blue-200 bg-white p-3 text-[#162447]" /> : <p className="mt-2 text-xs text-[#6B7A99]">Not selected</p>}
          </div>)}</div>
        </section>)}
        <section className="space-y-2"><h3 className="font-bold text-[#162447]">3. Exchange Rate</h3>
          {rate.data ? <p className="text-sm text-[#6B7A99]">USD 1 = UGX {rate.data.rate.toLocaleString()} · Current authorized rate</p> : <p role="alert" className="text-red-700">A Manager/Admin must configure the exchange rate before opening.</p>}
          {!review && <button type="button" onClick={() => rate.refetch()} className="min-h-11 text-sm text-blue-700 underline">Refresh rate</button>}
          {!review && user?.role !== 'CASHIER' && <Link href="/exchange-rate" className="ml-4 inline-flex min-h-11 items-center text-sm text-blue-700 underline">Manage exchange rate</Link>}
        </section>
        {review && <p className="text-sm text-[#6B7A99]">Cashier: {user?.name}. Each selected balance will be recorded separately at confirmation.</p>}
        {opening.isError && <p role="alert" className="text-sm text-red-700">{(opening.error as any)?.response?.data?.message || 'Opening failed. Check your connection and retry.'}</p>}
        <div className="flex flex-wrap justify-end gap-3 border-t border-blue-100 pt-4">
          {review && <button disabled={opening.isPending} onClick={() => setReview(false)} className="min-h-11 rounded-xl border border-blue-200 px-4 text-[#162447]">Edit balances</button>}
          <button disabled={!valid || !rate.data || opening.isPending} onClick={() => {
            if (review) opening.mutate(); else { setReviewedRateId(rate.data!._id); setReview(true); }
          }} className="min-h-11 rounded-xl bg-blue-700 px-5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{opening.isPending ? 'Opening…' : review ? 'Confirm & Open Shift' : '4. Review & Confirm'}</button>
        </div>
      </>}
    </section>
  </div>;
}
