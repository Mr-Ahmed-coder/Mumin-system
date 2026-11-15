'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';
import {
  ArrowLeftRight,
  Building2,
  Calculator,
  FileBarChart,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  ShieldAlert,
  UserCog,
  Wallet,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';

const cashierNav = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'New Transaction', href: '/transactions/new', icon: PlusCircle },
  { name: 'Transactions', href: '/transactions', icon: ArrowLeftRight },
  { name: 'Shifts & Closing', href: '/cash-sessions', icon: Wallet },
];

const adminNav = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Transactions', href: '/transactions', icon: ArrowLeftRight },
  { name: 'Shifts & Closing', href: '/cash-sessions', icon: Wallet },
  { name: 'Reports', href: '/reports', icon: FileBarChart },
  { name: 'Exchange Rate', href: '/exchange-rate', icon: Calculator },
  { name: 'Fee Rules', href: '/fee-rules', icon: Calculator },
  { name: 'Staff', href: '/users', icon: UserCog },
  { name: 'Audit Logs', href: '/audit-logs', icon: ShieldAlert },
];

const depositArchive = { name: 'Deposit Archive', href: '/customer-deposits', icon: Landmark };

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isCashier = user?.role === 'CASHIER';
  const activeNav = isCashier ? cashierNav : user?.role === 'ADMIN' ? [...adminNav, depositArchive] : adminNav;

  const navigation = (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-white/15 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[#2F63F5] p-2.5 text-[#ffffff]">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-wide text-[#ffffff]">MUMIN AGENT</h1>
                <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-950">DEMO</span>
              </div>
              <p className="mt-0.5 text-xs font-medium text-[#DCE4F2]">Trial Evaluation</p>
            </div>
          </div>
          <button type="button" onClick={() => setMobileOpen(false)} className="rounded-xl p-2 text-[#DCE4F2] hover:bg-white/10 lg:hidden" aria-label="Close navigation">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 pb-2 pt-5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#DCE4F2]">
            {isCashier ? 'Cashier workspace' : 'Management workspace'}
          </span>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3" aria-label="Primary navigation">
          {activeNav.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            const Icon = item.icon;
            const section = item.href === '/dashboard' ? 'Daily work' : item.href === '/exchange-rate' ? 'Administration' : item.href === depositArchive.href ? 'Historical records' : null;
            return (
              <Fragment key={item.href}>
              {section && <p className="px-3.5 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-[#DCE4F2]">{section}</p>}
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={clsx(
                  'group flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all duration-200',
                  isActive ? 'bg-[#2F63F5] text-[#ffffff] shadow-sm' : 'text-[#DCE4F2] hover:bg-[#162447] hover:text-[#ffffff]'
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                <span>{item.name}</span>
              </Link>
              </Fragment>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-white/15 p-3">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[#162447] p-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-black text-blue-700">
              {user?.name?.charAt(0) || 'M'}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[#ffffff]">{user?.name}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#DCE4F2]">{user?.role}</p>
            </div>
          </div>
          <button type="button" onClick={logout} title="Log out" aria-label="Log out" className="rounded-xl p-2.5 text-[#DCE4F2] transition-colors hover:bg-[#2452D6] hover:text-[#ffffff]">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <button type="button" onClick={() => setMobileOpen(true)} className="fixed left-4 top-3.5 z-40 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/25 lg:hidden" aria-label="Open navigation" aria-expanded={mobileOpen}>
        <Menu className="h-5 w-5" />
      </button>

      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-hidden bg-[#162447] lg:flex">
        {navigation}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button type="button" className="absolute inset-0 bg-ink/35 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />
          <aside className="relative flex h-full w-[86%] max-w-xs flex-col bg-[#162447] shadow-2xl">{navigation}</aside>
        </div>
      )}
    </>
  );
}
