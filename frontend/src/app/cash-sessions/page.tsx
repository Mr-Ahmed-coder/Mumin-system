'use client';

import { useState } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import Navbar from '@/components/layout/Navbar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CashSession, WALLET_LABELS, WalletProvider } from '@/types';
import {
  Wallet,
  PlusCircle,
  MinusCircle,
  CheckCircle,
  AlertTriangle,
  Lock,
  History,
  X,
} from 'lucide-react';
import Link from 'next/link';
import OpeningBalancesGrid from '@/components/cash-sessions/OpeningBalancesGrid';
import ExpandedOpeningForm from '@/components/cash-sessions/ExpandedOpeningForm';
import { reconciliationAccountId } from '@/lib/reconciliation';
import { useAuth } from '@/providers/AuthProvider';
import ReconciliationAccounts from '@/components/cash-sessions/ReconciliationAccounts';

export default function CashSessionsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isOpenModalOpen, setIsOpenModalOpen] = useState(false);
  const [isAddCashOpen, setIsAddCashOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);

  // Form states
  const [amount, setAmount] = useState<number | ''>('');
  const [evcOpeningBalance, setEvcOpeningBalance] = useState<number | ''>('');
  const [mobileMoneyOpeningBalance, setMobileMoneyOpeningBalance] = useState<number | ''>('');
  const [mobileMoneyProvider, setMobileMoneyProvider] = useState<WalletProvider>('TELESOM_ZAAD');
  const [reason, setReason] = useState('');
  const [closingActuals, setClosingActuals] = useState<Record<string, number | ''>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const { data: currentData, refetch: refetchCurrent } = useQuery<{ data: CashSession | null }>({
    queryKey: ['activeCashSession', user?._id],
    queryFn: async () => {
      const res = await api.get('/cash-sessions/current');
      return res.data;
    },
  });

  const { data: pastData } = useQuery<{ data: CashSession[] }>({
    queryKey: ['cashSessionsList'],
    enabled: user?.role === 'ADMIN' || user?.role === 'MANAGER',
    queryFn: async () => {
      const res = await api.get('/cash-sessions');
      return res.data;
    },
  });

  const activeSession = currentData?.data;
  const openingMode = useQuery<{ expanded: boolean }>({
    queryKey: ['shiftOpeningMode', user?._id],
    queryFn: async () => {
      const { data } = await api.get('/cash-sessions/opening-mode');
      if (typeof data?.data?.expanded !== 'boolean') throw new Error('Invalid opening mode');
      return data.data;
    },
    enabled: Boolean(user && isOpenModalOpen),
  });
  const ledgerClosing = activeSession?.ledgerVersion === 1 || activeSession?.openingVersion === 2;
  const pastSessions = pastData?.data || [];

  const openSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/cash-sessions/open', {
        openingCash: Number(amount),
        evcOpeningBalanceUSD: Number(evcOpeningBalance),
        mobileMoneyOpeningBalanceUSD: Number(mobileMoneyOpeningBalance),
        mobileMoneyProvider,
        notes: notes || undefined,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeCashSession'] });
      setIsOpenModalOpen(false);
      resetForm();
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to open shift'),
  });

  const addCashMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/cash-sessions/add-cash', {
        amount: Number(amount),
        reason,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeCashSession'] });
      setIsAddCashOpen(false);
      resetForm();
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to add cash'),
  });

  const withdrawCashMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/cash-sessions/withdraw-cash', {
        amount: Number(amount),
        reason,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeCashSession'] });
      setIsWithdrawOpen(false);
      resetForm();
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to withdraw cash'),
  });

  const closeSessionMutation = useMutation({
    mutationFn: async () => {
      const accounts = activeSession?.reconciliationPreview || [];
      const res = await api.post('/cash-sessions/close', {
        actualBalances: accounts.map((account) => ({
          accountId: reconciliationAccountId(account),
          accountType: account.accountType,
          provider: account.provider,
          currency: account.currency,
          amount: Number(closingActuals[reconciliationAccountId(account)]),
        })),
        notes: notes || undefined,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeCashSession'] });
      queryClient.invalidateQueries({ queryKey: ['cashSessionsList'] });
      setIsCloseModalOpen(false);
      resetForm();
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to close shift'),
  });

  const resetForm = () => {
    setAmount('');
    setReason('');
    setEvcOpeningBalance('');
    setMobileMoneyOpeningBalance('');
    setMobileMoneyProvider('TELESOM_ZAAD');
    setClosingActuals({});
    setNotes('');
    setError('');
  };

  return (
    <div className="flex min-h-screen bg-slate-950">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />

        <main className="p-8 space-y-8 flex-1">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Cash Drawer Management</h1>
              <p className="text-sm text-slate-400">
                Shift cash balancing, cash added/withdrawn, and End-of-Day reconciliation
              </p>
            </div>
            {!activeSession ? (
              <button
                onClick={() => {
                  resetForm();
                  setIsOpenModalOpen(true);
                }}
                className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2.5 rounded-xl font-semibold text-sm shadow-lg shadow-brand-600/20 transition-all self-start"
              >
                <Wallet className="w-4 h-4" />
                Open Cash Shift
              </button>
            ) : ledgerClosing ? (
              activeSession.closingEligibility?.ready ? (
                <Link href={`/cash-sessions/${activeSession._id}/close`} className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl bg-blue-700 px-4 py-2 font-semibold text-[#ffffff] focus-visible:ring-2 focus-visible:ring-blue-600">
                  <Lock className="h-4 w-4" /> Close Shift
                </Link>
              ) : (
                <div className="max-w-sm space-y-2">
                  <button type="button" disabled className="rounded-lg bg-slate-200 px-4 py-2 font-semibold text-[#6B7A99]">Close Shift</button>
                  <p role="status" className="text-sm text-[#6B7A99]">{activeSession.closingEligibility?.reason || 'Closing balances are unavailable.'}</p>
                </div>
              )
            ) : (
              <button
                onClick={() => {
                  resetForm();
                  setIsCloseModalOpen(true);
                }}
                className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-[#ffffff] font-bold px-4 py-2.5 rounded-xl text-sm shadow-lg shadow-brand-600/20 transition-all self-start"
              >
                <Lock className="w-4 h-4" />
                Close Shift & Reconcile
              </button>
            )}
          </div>

          {/* Active Shift Overview Box */}
          {activeSession ? (
            <div className="p-8 rounded-2xl bg-white border border-line shadow-2xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
                <div>
                  <span className="text-xs font-mono text-brand-600 font-bold uppercase tracking-wider">
                    {activeSession.sessionNumber}
                  </span>
                  <h2 className="text-xl font-bold text-white mt-1">Active Shift</h2>
                  <p className="text-xs text-slate-400">Opened at: {new Date(activeSession.openedAt).toLocaleString()}</p>
                  {activeSession.ledgerVersion === 1 && <Link className="mt-2 inline-block text-sm font-medium text-blue-700 underline" href={`/cash-sessions/${activeSession._id}`}>View account movements</Link>}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      resetForm();
                      setIsAddCashOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-brand-50 border border-line text-brand-600 font-semibold text-xs rounded-xl border border-slate-700 transition-colors"
                  >
                    <PlusCircle className="w-4 h-4" />
                    Add Cash
                  </button>
                  <button
                    onClick={() => {
                      resetForm();
                      setIsWithdrawOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-brand-50 border border-line text-ink font-semibold text-xs rounded-xl border border-slate-700 transition-colors"
                  >
                    <MinusCircle className="w-4 h-4" />
                    Withdraw Cash
                  </button>
                </div>
              </div>

              <OpeningBalancesGrid session={activeSession} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-5 bg-slate-950/80 rounded-xl border border-slate-800">
                  <span className="text-xs font-semibold text-slate-400 uppercase">Exchanges Processed</span>
                  <p className="text-2xl font-extrabold text-blue-400 mt-2">
                    {activeSession.totalTransactionsCount || 0} Txns (UGX {activeSession.totalCashPaidOut?.toLocaleString() || '0'} Paid)
                  </p>
                </div>
                <div className="p-5 bg-slate-950/80 rounded-xl border border-line">
                  <span className="text-xs font-semibold text-brand-600 uppercase">Available Cash (UGX)</span>
                  <p className="text-3xl font-extrabold text-brand-600 mt-2">
                    {typeof activeSession.currentCashBalance === 'number' ? `UGX ${activeSession.currentCashBalance.toLocaleString()}` : 'Unavailable'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4 shadow-xl">
              <div className="w-12 h-12 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                <Wallet className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">No Active Cash Shift</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Open a cash shift drawer before processing cash exchanges for customers.
              </p>
            </div>
          )}

          {/* Past Shift History Ledger */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden space-y-4 p-6">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-brand-600" />
              Shift Reconciliations History
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase text-slate-400 font-semibold bg-slate-950/50">
                    <th className="py-3.5 px-4">Session No.</th>
                    <th className="py-3.5 px-4">Cashier</th>
                    <th className="py-3.5 px-4">Opening Cash (UGX)</th>
                    <th className="py-3.5 px-4">Expected Closing (UGX)</th>
                    <th className="py-3.5 px-4">Actual Closing (UGX)</th>
                    <th className="py-3.5 px-4">Difference (UGX)</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-sm">
                  {pastSessions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        No shift history records available.
                      </td>
                    </tr>
                  ) : (
                    pastSessions.map((s) => (
                      <tr key={s._id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3.5 px-4 font-mono font-semibold text-brand-600 text-xs">
                          {s.sessionNumber}
                        </td>
                        <td className="py-3.5 px-4 text-slate-200">{(s.cashierId as any)?.name || 'Cashier'}</td>
                        <td className="py-3.5 px-4 font-mono text-slate-300">UGX {s.openingCash.toLocaleString()}</td>
                        <td className="py-3.5 px-4 font-mono text-slate-300">
                          UGX {s.closingCashSystem?.toLocaleString() || '0'}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-brand-600 font-bold">
                          {s.closingCashActual === undefined ? '—' : `UGX ${s.closingCashActual.toLocaleString()}`}
                        </td>
                        <td className="py-3.5 px-4 font-mono">
                          {s.discrepancy === undefined ? (
                            '—'
                          ) : s.discrepancy === 0 ? (
                            <span className="text-brand-600">UGX 0 (Balanced)</span>
                          ) : s.discrepancy < 0 ? (
                            <span className="text-red-400 font-bold">UGX -{Math.abs(s.discrepancy).toLocaleString()} (Shortage)</span>
                          ) : (
                            <span className="text-amber-400 font-bold">UGX +{s.discrepancy.toLocaleString()} (Over)</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${
                              s.status === 'OPEN'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <Link
                            href={`/cash-sessions/${s._id}`}
                            className="px-2.5 py-1 text-xs font-semibold text-ink bg-white hover:bg-brand-50 border border-line rounded-lg transition-colors inline-block"
                          >
                            View Audit
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {/* Open Shift Modal */}
      {isOpenModalOpen && !openingMode.data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <section role="dialog" aria-modal="true" aria-label="Open Shift" className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-white p-6 text-ink">
            <p role={openingMode.isError ? 'alert' : 'status'}>
              {openingMode.isError ? 'Could not verify which opening form this server supports.' : 'Checking available opening accounts…'}
            </p>
            {openingMode.isError && <button type="button" onClick={() => openingMode.refetch()} className="mr-4 font-semibold text-brand-600">Retry</button>}
            <button type="button" onClick={() => setIsOpenModalOpen(false)} className="font-semibold">Cancel</button>
          </section>
        </div>
      )}
      {isOpenModalOpen && openingMode.data?.expanded === true && (
        <ExpandedOpeningForm close={() => setIsOpenModalOpen(false)} onOpened={() => {
          queryClient.invalidateQueries({ queryKey: ['activeCashSession'] });
          queryClient.invalidateQueries({ queryKey: ['cashSessionsList'] });
          setIsOpenModalOpen(false);
        }} />
      )}
      {isOpenModalOpen && openingMode.data?.expanded === false && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-brand-600" />
                  Open Shift
                </h3>
                <p className="mt-1 text-xs text-slate-400">Record each account&apos;s opening balance separately.</p>
              </div>
              <button onClick={() => setIsOpenModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-xl">{error}</div>}

            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                  Physical Cash Opening Balance (UGX) *
                </label>
                <input
                  type="number"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
                  step="1"
                  placeholder="e.g. 8,500,000"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-slate-100 font-bold text-lg focus:outline-none focus:border-brand-600"
                />
                <p className="mt-1.5 text-[11px] text-slate-500">Provider: Cash Drawer · Whole UGX only</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                    EVC Opening Balance (USD) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={evcOpeningBalance}
                    onChange={(e) => setEvcOpeningBalance(e.target.value ? Number(e.target.value) : '')}
                    placeholder="e.g. 1,500"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-slate-100 font-bold focus:outline-none focus:border-brand-600"
                  />
                  <p className="mt-1.5 text-[11px] text-slate-500">Provider: Hormuud EVC Plus</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                    Mobile Money Opening Balance (USD) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={mobileMoneyOpeningBalance}
                    onChange={(e) => setMobileMoneyOpeningBalance(e.target.value ? Number(e.target.value) : '')}
                    placeholder="e.g. 800"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-slate-100 font-bold focus:outline-none focus:border-brand-600"
                  />
                  <p className="mt-1.5 text-[11px] text-slate-500">Select its provider below.</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                  Mobile Money Provider *
                </label>
                <select
                  value={mobileMoneyProvider}
                  onChange={(e) => setMobileMoneyProvider(e.target.value as WalletProvider)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-slate-100 text-sm focus:outline-none focus:border-brand-600"
                >
                  {Object.entries(WALLET_LABELS)
                    .filter(([provider]) => provider !== 'HORMUUD_EVC_PLUS')
                    .map(([provider, label]) => <option key={provider} value={provider}>{label}</option>)}
                </select>
                <p className="mt-1.5 text-[11px] text-slate-500">EVC and Mobile Money use the existing USD wallet transaction currency.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Shift start notes..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 px-3 text-slate-100 text-xs focus:outline-none focus:border-brand-600"
                />
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
              <button onClick={() => setIsOpenModalOpen(false)} className="px-4 py-2 rounded-xl text-slate-400 text-xs font-semibold">
                Cancel
              </button>
              <button
                disabled={amount === '' || evcOpeningBalance === '' || mobileMoneyOpeningBalance === '' || openSessionMutation.isPending}
                onClick={() => openSessionMutation.mutate()}
                className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-[#ffffff] text-xs font-semibold shadow-lg shadow-brand-600/20 disabled:opacity-50"
              >
                {openSessionMutation.isPending ? 'Opening...' : 'Open Shift'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Withdraw Cash Modal */}
      {(isAddCashOpen || isWithdrawOpen) && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-lg font-bold text-white">
                {isAddCashOpen ? 'Add Cash to Drawer' : 'Withdraw Cash from Drawer'}
              </h3>
              <button onClick={() => { setIsAddCashOpen(false); setIsWithdrawOpen(false); }} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-xl">{error}</div>}

            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                  {isAddCashOpen ? 'Cash Added (UGX) *' : 'Cash Withdrawn (UGX) *'}
                </label>
                <input
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
                  step="1"
                  placeholder="e.g. 500,000"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-slate-100 font-bold focus:outline-none focus:border-brand-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                  Reason *
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Bank cash replenishment"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 px-3 text-slate-100 text-xs focus:outline-none focus:border-brand-600"
                />
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
              <button onClick={() => { setIsAddCashOpen(false); setIsWithdrawOpen(false); }} className="px-4 py-2 rounded-xl text-slate-400 text-xs font-semibold">
                Cancel
              </button>
              <button
                disabled={!amount || !reason || addCashMutation.isPending || withdrawCashMutation.isPending}
                onClick={() => (isAddCashOpen ? addCashMutation.mutate() : withdrawCashMutation.mutate())}
                className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-[#ffffff] text-xs font-semibold shadow-lg shadow-brand-600/20 disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Shift Modal */}
      {isCloseModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-6xl max-h-[92vh] overflow-y-auto rounded-2xl p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Lock className="w-5 h-5 text-brand-600" />
                  Close Shift & Reconcile Accounts
                </h3>
                <p className="mt-1 text-xs text-slate-400">Count each account separately. Different currencies are never combined.</p>
              </div>
              <button onClick={() => setIsCloseModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-xl">{error}</div>}

            <div className="space-y-5 text-sm">
              <ReconciliationAccounts
                accounts={activeSession?.reconciliationPreview || []}
                actualValues={closingActuals}
                onActualChange={(accountType, value) =>
                  setClosingActuals((current) => ({ ...current, [accountType]: value }))
                }
              />

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                  Shift Closing Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Reconciliation notes..."
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 px-3 text-slate-100 text-xs focus:outline-none focus:border-brand-600"
                />
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
              <button onClick={() => setIsCloseModalOpen(false)} className="px-4 py-2 rounded-xl text-slate-400 text-xs font-semibold">
                Cancel
              </button>
              <button
                disabled={
                  !activeSession?.reconciliationPreview?.length ||
                  activeSession.reconciliationPreview.some(
                    (account) => closingActuals[reconciliationAccountId(account)] === '' || closingActuals[reconciliationAccountId(account)] === undefined
                  ) ||
                  closeSessionMutation.isPending
                }
                onClick={() => closeSessionMutation.mutate()}
                className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-[#ffffff] font-bold text-xs shadow-lg shadow-brand-600/20 disabled:opacity-50"
              >
                {closeSessionMutation.isPending ? 'Closing...' : 'Close & Submit Shift'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
