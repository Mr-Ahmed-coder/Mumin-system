'use client';

import { useState } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import Navbar from '@/components/layout/Navbar';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Transaction, WALLET_LABELS, WalletProvider, User } from '@/types';
import {
  FileText,
  Download,
  Printer,
  Calendar,
  Filter,
  DollarSign,
  TrendingUp,
  Wallet,
  Users,
  UserCheck,
  BarChart3,
  FileSpreadsheet,
} from 'lucide-react';

type ReportAmount = number | null | undefined;
type ReportBreakdown = { name: string; volumeUSD?: ReportAmount; feeUSD?: ReportAmount; volume?: ReportAmount; fee?: ReportAmount; count: number };
const money = (currency: 'USD' | 'UGX', current: ReportAmount, legacy?: ReportAmount) => {
  const value = current ?? legacy;
  return typeof value === 'number' && Number.isFinite(value) ? `${currency} ${value.toLocaleString()}` : '—';
};

export default function ReportsPage() {
  // Preset Date Quick Select
  const [dateRangePreset, setDateRangePreset] = useState<'today' | 'weekly' | 'monthly' | 'custom'>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Filter Dropdowns
  const [selectedCashier, setSelectedCashier] = useState('');
  const [selectedWallet, setSelectedWallet] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('COMPLETED');

  // Fetch Cashier Users List for dropdown
  const { data: usersData } = useQuery<{ data: User[] }>({
    queryKey: ['cashierUsersList'],
    queryFn: async () => {
      const res = await api.get('/users');
      return res.data;
    },
  });

  const cashiersList = usersData?.data || [];

  // Compute effective query dates
  const getEffectiveDates = () => {
    if (dateRangePreset === 'custom') {
      return { startDate, endDate };
    }
    const now = new Date();
    if (dateRangePreset === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);
      return { startDate: start, endDate: start };
    }
    if (dateRangePreset === 'weekly') {
      const past = new Date();
      past.setDate(past.getDate() - 6);
      return {
        startDate: past.toISOString().slice(0, 10),
        endDate: now.toISOString().slice(0, 10),
      };
    }
    if (dateRangePreset === 'monthly') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      return { startDate: start, endDate: now.toISOString().slice(0, 10) };
    }
    return { startDate: '', endDate: '' };
  };

  const dates = getEffectiveDates();

  // Comprehensive Report Query
  const { data: reportData, isLoading } = useQuery({
    queryKey: [
      'comprehensiveReport',
      dates.startDate,
      dates.endDate,
      selectedCashier,
      selectedWallet,
      selectedStatus,
    ],
    queryFn: async () => {
      const res = await api.get('/reports/summary', {
        params: {
          startDate: dates.startDate || undefined,
          endDate: dates.endDate || undefined,
          cashierId: selectedCashier || undefined,
          walletProvider: selectedWallet || undefined,
          status: selectedStatus || undefined,
        },
      });
      return res.data.data;
    },
  });

  const summary = reportData?.summary;
  const transactions: Transaction[] = reportData?.transactions || [];
  const topCashiers: ReportBreakdown[] = reportData?.topCashiers || [];
  const topCustomers: (ReportBreakdown & { phone: string })[] = reportData?.topCustomers || [];
  const walletDistribution: (Omit<ReportBreakdown, 'name'> & { provider: WalletProvider })[] = reportData?.walletDistribution || [];
  const accountMovements: { accountId: string; currency: 'USD' | 'UGX'; category: string; direction: 'IN' | 'OUT'; amount: number }[] | undefined = reportData?.accountMovements;

  const handlePrint = () => {
    window.print();
  };

  const [exportError, setExportError] = useState('');
  const download = async (format: 'excel' | 'csv') => {
    setExportError('');
    try {
      const { data } = await api.get(`/reports/export/${format}`, {
        responseType: 'blob', params: { startDate: dates.startDate || undefined, endDate: dates.endDate || undefined,
          cashierId: selectedCashier || undefined, walletProvider: selectedWallet || undefined, status: selectedStatus || 'COMPLETED' },
      });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mumin-agent-transactions.${format === 'excel' ? 'xlsx' : 'csv'}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setExportError('Could not download the report. Please try again.'); }
  };
  const handleExportExcel = () => void download('excel');
  const handleExportCSV = () => void download('csv');

  return (
    <div className="flex min-h-screen bg-slate-950">
      <div className="print:hidden">
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="print:hidden">
          <Navbar />
        </div>

        <main className="p-8 space-y-8 flex-1 print:p-0">
          {exportError && <p role="alert" className="text-sm text-red-700">{exportError}</p>}
          {/* Header & Export Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6 print:hidden">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                <BarChart3 className="w-6 h-6 text-brand-600" />
                Reports & Financial Analytics
              </h1>
              <p className="text-sm text-slate-400">
                Review daily transactions, USD service fees, and UGX payouts.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all"
              >
                <Printer className="w-4 h-4" />
                Print PDF
              </button>
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-ink font-semibold px-4 py-2.5 rounded-xl text-sm transition-all"
              >
                <FileText className="w-4 h-4" />
                Export CSV
              </button>
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-[#ffffff] font-semibold px-4 py-2.5 rounded-xl text-sm shadow-lg shadow-brand-600/20 transition-all"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Export Excel (.xlsx)
              </button>
            </div>
          </div>

          {/* Printable Report Header */}
          <div className="hidden print:block mb-8 text-black border-b pb-4">
            <h1 className="text-2xl font-bold uppercase tracking-wider">Mumin Agent - Financial Exchange Report</h1>
            <p className="text-xs text-gray-600">
              Generated Date: {new Date().toLocaleString()} | Period: {dates.startDate || 'All Time'} to {dates.endDate || 'Present'}
            </p>
          </div>

          {/* Filters Bar */}
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-4 print:hidden">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <Filter className="w-4 h-4 text-brand-600" />
              Report Presets & Dimensions Filter
            </div>

            {/* Quick Date Presets */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setDateRangePreset('today')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  dateRangePreset === 'today'
                    ? 'bg-brand-600 text-[#ffffff] font-bold'
                    : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Daily (Today)
              </button>
              <button
                onClick={() => setDateRangePreset('weekly')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  dateRangePreset === 'weekly'
                    ? 'bg-brand-600 text-[#ffffff] font-bold'
                    : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Weekly (7 Days)
              </button>
              <button
                onClick={() => setDateRangePreset('monthly')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  dateRangePreset === 'monthly'
                    ? 'bg-brand-600 text-[#ffffff] font-bold'
                    : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Monthly (This Month)
              </button>
              <button
                onClick={() => setDateRangePreset('custom')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  dateRangePreset === 'custom'
                    ? 'bg-brand-600 text-[#ffffff] font-bold'
                    : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Custom Date Range
              </button>
            </div>

            {/* Custom Dates & Dropdown Filters Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 pt-2 border-t border-slate-800 text-xs">
              {dateRangePreset === 'custom' && (
                <>
                  <div>
                    <label className="block text-slate-400 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-slate-200"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-slate-400 mb-1">Filter Cashier</label>
                <select
                  value={selectedCashier}
                  onChange={(e) => setSelectedCashier(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-slate-200"
                >
                  <option value="">All Cashiers</option>
                  {cashiersList.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name} ({c.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Filter Wallet</label>
                <select
                  value={selectedWallet}
                  onChange={(e) => setSelectedWallet(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-slate-200"
                >
                  <option value="">All Digital Wallets</option>
                  {Object.entries(WALLET_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Status</label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-slate-200"
                >
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                  <option value="">All Statuses</option>
                </select>
              </div>
            </div>
          </div>

          {/* KPI Financial Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-1 print:bg-white print:border-gray-300">
              <span className="text-xs font-semibold text-slate-400 uppercase print:text-black">Exchanges Count</span>
              <p className="text-2xl font-extrabold text-white print:text-black">
                {summary?.totalTransactionsCount || 0}
              </p>
            </div>

            <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-1 print:bg-white print:border-gray-300">
              <span className="text-xs font-semibold text-slate-400 uppercase print:text-black">Total Exchange Volume</span>
              <p className="text-2xl font-extrabold text-white print:text-black">
                ${summary?.totalVolume?.toLocaleString() || '0'}
              </p>
            </div>

            <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-1 print:bg-white print:border-gray-300">
              <span className="text-xs font-semibold text-slate-400 uppercase print:text-black">Gross Fees Collected</span>
              <p className="text-2xl font-extrabold text-ink print:text-black">
                ${summary?.totalServiceFees?.toLocaleString() || '0'}
              </p>
            </div>

            <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-1 print:bg-white print:border-gray-300">
              <span className="text-xs font-semibold text-slate-400 uppercase print:text-black">Total Cash Paid Out</span>
              <p className="text-2xl font-extrabold text-blue-400 print:text-black">
                {money('UGX', summary?.totalCashPaidOutUGX, summary?.totalCashPaidOut)}
              </p>
            </div>

            <div className="p-5 bg-slate-900 border border-line rounded-2xl shadow-xl space-y-1 print:bg-white print:border-gray-300">
              <span className="text-xs font-semibold text-brand-600 uppercase print:text-black">Net Fee Profit</span>
              <p className="text-2xl font-extrabold text-brand-600 print:text-black">
                ${summary?.totalProfit?.toLocaleString() || '0'}
              </p>
            </div>
          </div>

          {/* Aggregated Analytics Tables Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Top Cashiers Audit Performance Table */}
            <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-4 print:bg-white print:border-gray-300">
              <h3 className="text-base font-bold text-white print:text-black flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-brand-600" />
                Cashier Performance Yield
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase bg-slate-950/50 print:bg-gray-100 print:text-black">
                      <th className="py-2.5 px-3">Cashier</th>
                      <th className="py-2.5 px-3 text-right">Volume</th>
                      <th className="py-2.5 px-3 text-right">Fees</th>
                      <th className="py-2.5 px-3 text-right">Txns</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {topCashiers.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-slate-500">No records found</td>
                      </tr>
                    ) : (
                      topCashiers.map((c, i) => (
                        <tr key={i} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-sans font-medium text-slate-200 print:text-black">{c.name}</td>
                          <td className="py-2.5 px-3 text-right text-slate-100 print:text-black">{money('USD', c.volumeUSD, c.volume)}</td>
                          <td className="py-2.5 px-3 text-right text-ink print:text-black">{money('USD', c.feeUSD, c.fee)}</td>
                          <td className="py-2.5 px-3 text-right text-slate-400 print:text-black">{c.count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {accountMovements && <section className="rounded-2xl border bg-white p-5 text-slate-900">
              <h2 className="font-bold">Recorded account movements</h2>
              <p className="text-sm text-slate-600">Ledger activity only, not revenue. Historical activity without verified ledger entries is excluded.</p>
              <ul className="mt-3 space-y-2">{accountMovements.map(row => (
                <li key={`${row.accountId}:${row.currency}:${row.category}:${row.direction}`} className="flex flex-wrap justify-between gap-2 border-b py-2 text-sm">
                  <span>{WALLET_LABELS[row.accountId as WalletProvider] || row.accountId} · {row.category.replaceAll('_', ' ')}</span>
                  <strong>{row.direction === 'IN' ? '+' : '−'} {row.currency} {row.amount.toLocaleString()}</strong>
                </li>
              ))}</ul>
              {accountMovements.length === 0 && <p className="mt-3 text-sm">No ledger movements for this period.</p>}
            </section>}
            {/* Wallet Provider Distribution */}
            <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-4 print:bg-white print:border-gray-300">
              <h3 className="text-base font-bold text-white print:text-black flex items-center gap-2">
                <Wallet className="w-4 h-4 text-blue-400" />
                Digital Wallet Revenue Yield
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase bg-slate-950/50 print:bg-gray-100 print:text-black">
                      <th className="py-2.5 px-3">Provider</th>
                      <th className="py-2.5 px-3 text-right">Volume</th>
                      <th className="py-2.5 px-3 text-right">Fees</th>
                      <th className="py-2.5 px-3 text-right">Txns</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {walletDistribution.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-slate-500">No records found</td>
                      </tr>
                    ) : (
                      walletDistribution.map((w, i) => (
                        <tr key={i} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-sans font-medium text-slate-200 print:text-black">
                            {WALLET_LABELS[w.provider as WalletProvider] || w.provider}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-100 print:text-black">{money('USD', w.volumeUSD, w.volume)}</td>
                          <td className="py-2.5 px-3 text-right text-ink print:text-black">{money('USD', w.feeUSD, w.fee)}</td>
                          <td className="py-2.5 px-3 text-right text-slate-400 print:text-black">{w.count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top Customer Leaderboard */}
            <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-4 print:bg-white print:border-gray-300">
              <h3 className="text-base font-bold text-white print:text-black flex items-center gap-2">
                <Users className="w-4 h-4 text-ink" />
                Top Customer Volume Leaderboard
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase bg-slate-950/50 print:bg-gray-100 print:text-black">
                      <th className="py-2.5 px-3">Customer</th>
                      <th className="py-2.5 px-3 text-right">Volume</th>
                      <th className="py-2.5 px-3 text-right">Fees</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {topCustomers.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-4 text-center text-slate-500">No records found</td>
                      </tr>
                    ) : (
                      topCustomers.map((cust, i) => (
                        <tr key={i} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-sans font-medium text-slate-200 print:text-black">
                            {cust.name}
                            <div className="text-[10px] text-slate-500 print:text-gray-600">{cust.phone}</div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-brand-600 print:text-black">
                            {money('USD', cust.volumeUSD, cust.volume)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-ink print:text-black">{money('USD', cust.feeUSD, cust.fee)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Itemized Transactions Ledger Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden p-6 space-y-4 print:bg-white print:border-gray-300">
            <h3 className="text-base font-bold text-white print:text-black">Filtered Transaction Records</h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase text-slate-400 font-semibold bg-slate-950/50 print:bg-gray-100 print:text-black">
                    <th className="py-3 px-4">Txn No.</th>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Wallet</th>
                    <th className="py-3 px-4 text-right">Received</th>
                    <th className="py-3 px-4 text-right">Fee</th>
                    <th className="py-3 px-4 text-right">Cash Paid</th>
                    <th className="py-3 px-4">Cashier</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-sm font-mono">
                  {isLoading ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500 print:text-black">
                        Generating report data...
                      </td>
                    </tr>
                  ) : transactions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500 print:text-black">
                        No transactions match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    transactions.map((t) => (
                      <tr key={t._id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3.5 px-4 font-semibold text-brand-600 text-xs print:text-black">
                          {t.transactionNumber}
                        </td>
                        <td className="py-3.5 px-4 text-slate-300 text-xs font-sans print:text-black">
                          {new Date(t.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 font-sans font-medium text-slate-200 print:text-black">
                          {(t.customerId as any)?.name || 'Walk-in'}
                          <div className="text-xs text-slate-500 font-mono print:text-gray-600">{t.customerPhone}</div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-300 font-sans print:text-black">
                          {WALLET_LABELS[t.walletProvider] || t.walletProvider}
                        </td>
                        <td className="py-3.5 px-4 text-right font-semibold text-slate-100 print:text-black">
                          {money('USD', t.amountReceivedUSD, t.amountReceived)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-medium text-ink print:text-black">
                          {money('USD', t.serviceFeeUSD, t.serviceFee)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-brand-600 print:text-black">
                          {money('UGX', t.cashPaidUGX, t.cashPaid)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-300 font-sans text-xs print:text-black">
                          {(t.cashierId as any)?.name || 'System'}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 print:border-gray-400 print:text-black">
                            {t.status}
                          </span>
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
    </div>
  );
}
