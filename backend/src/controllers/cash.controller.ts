import { Request, Response } from 'express';
import { CashSession } from '../models/CashSession';
import { Transaction } from '../models/Transaction';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiResponse } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import { UserRole } from '../constants/roles';
import { WalletProvider } from '../constants/wallets';
import { AuditLog } from '../models/AuditLog';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { isExpandedLedgerEnabled } from '../config/features';
import { ExchangeRate } from '../models/ExchangeRate';
import { readLedgerBalances } from '../services/ledgerRead.service';
import { closeLedgerShift, ledgerCloseInput, ledgerClosingEligibility, previewLedgerClose, reopenLedgerShift } from '../services/ledgerClosing.service';
import { rejectExpandedLegacyWrite } from '../services/legacyMovementGuard.service';
import { useLedgerIntegration, postLegacyFinancialRequest } from '../services/legacyLedgerAdapter.service';
import { expandedOpeningSchema, getOpeningAccountCatalog, prepareOpeningAccounts } from '../services/openingAccounts.service';
import { createOpeningBalances } from '../services/openingBalance.service';
import {
  ActualBalanceInput,
  assertOpenSessionModification,
  buildReconciliationPreview,
  reconcileAccounts,
} from '../services/reconciliation.service';

const cashPaidUGX = (transaction: any): number =>
  transaction.cashPaidUGX ?? transaction.cashPaid ?? 0;

const expandedOpeningEnabled = () => isExpandedLedgerEnabled();
export const getOpeningAccounts = asyncHandler(async (_req: Request, res: Response) => {
  if (!expandedOpeningEnabled()) throw ApiError.notFound('Development opening workflow is unavailable');
  return ApiResponse.success(res, 'Development opening account catalog', getOpeningAccountCatalog());
});

export const openExpandedCashSession = asyncHandler(async (req: Request, res: Response) => {
  if (!expandedOpeningEnabled()) throw ApiError.notFound('Development opening workflow is unavailable');
  let accounts;
  let input;
  try { input = expandedOpeningSchema.parse(req.body); accounts = prepareOpeningAccounts(input); }
  catch { throw ApiError.badRequest('Select unique configured accounts and enter valid non-negative balances and exchange rate'); }
  const cashierId = req.user!.id;
  if (await CashSession.exists({ cashierId, status: 'OPEN' })) throw ApiError.badRequest('You already have an open shift');
  const rate = await ExchangeRate.findOne({ _id: input.exchangeRateId, status: 'ACTIVE', baseCurrency: 'USD', targetCurrency: 'UGX' });
  if (!rate) throw ApiError.badRequest('Exchange rate changed or is unavailable. Review the current rate before opening');
  await CashSession.init();
  const sessionId = new Types.ObjectId();
  const openingCash = accounts.find(a => a.id === 'CASH_UGX')!.amount;
  let session;
  try {
    session = await CashSession.create({ _id: sessionId, cashierId, activeShiftKey: cashierId,
      sessionNumber: `CS-${sessionId}`, openingVersion: 2, ledgerVersion: 1, openingCash, closingCashSystem: openingCash,
      openingBalances: [], accountOpenings: accounts, openedAt: new Date(),
      openingExchangeRate: { rateId: rate._id, rate: rate.rate, baseCurrency: 'USD', targetCurrency: 'UGX', recordedAt: new Date() } });
  } catch (error: any) {
    if (error.code === 11000) throw ApiError.badRequest('You already have an open shift');
    throw error;
  }
  await AuditLog.create({ userId: cashierId, userName: req.user?.name, userRole: req.user?.role,
    action: 'OPENING_BALANCES_RECORDED', resource: 'cash-sessions', resourceId: String(session._id),
    ipAddress: req.ip, userAgent: req.headers['user-agent'],
    details: { accountOpenings: accounts, openingExchangeRate: session.openingExchangeRate, developmentOnly: true } });
  return ApiResponse.created(res, 'Development shift opened with ledger tracking.', session);
});

export const getCurrentCashSession = asyncHandler(async (req: Request, res: Response) => {
  const cashierId = req.user?.id;
  const activeSession = await CashSession.findOne({ cashierId, status: 'OPEN' }).populate([
    { path: 'cashierId', select: 'name email role' },
    { path: 'openingBalances.cashierId', select: 'name email role' },
    { path: 'openingBalances.createdBy', select: 'name email role' },
  ]);

  if (!activeSession) {
    return ApiResponse.success(res, 'No active cash session', null);
  }

  // Calculate current system balance live
  const transactions = await Transaction.find({
    cashSessionId: activeSession._id,
    status: 'COMPLETED',
  });

  const totalCashPaidOut = transactions.reduce((acc, t) => acc + cashPaidUGX(t), 0);
  const totalCashAdded = activeSession.cashAdded.reduce((acc, a) => acc + a.amount, 0);
  const totalCashWithdrawn = activeSession.cashWithdrawn.reduce((acc, a) => acc + a.amount, 0);

  let currentCashBalance: number | undefined =
    activeSession.openingCash + totalCashAdded - totalCashWithdrawn - totalCashPaidOut;
  const ledgerShift = activeSession.openingVersion === 2 || activeSession.ledgerVersion === 1;
  const closingEligibility = ledgerShift ? await ledgerClosingEligibility(activeSession) : undefined;
  const accountBalances = await readLedgerBalances(activeSession).catch(error => {
    if (closingEligibility?.ready === false) return undefined;
    throw error;
  });
  if (activeSession.ledgerVersion === 1) {
    currentCashBalance = accountBalances?.find(account => account.id === 'CASH_UGX')?.balance;
  }
  if (activeSession.openingVersion === 2 && activeSession.ledgerVersion !== 1) currentCashBalance = undefined;
  const reconciliationPreview = activeSession.openingVersion === 2 || activeSession.ledgerVersion === 1 ? [] : buildReconciliationPreview(activeSession, transactions);

  return ApiResponse.success(res, 'Active cash session retrieved', {
    ...activeSession.toObject(),
    currentCashBalance,
    accountBalances,
    totalTransactionsCount: transactions.length,
    totalCashPaidOut,
    totalCashAdded,
    totalCashWithdrawn,
    reconciliationPreview,
    closingEligibility,
  });
});

export const getCashSessionById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const session = await CashSession.findById(id)
    .populate('cashierId', 'name email role')
    .populate('openingBalances.cashierId', 'name email role')
    .populate('openingBalances.createdBy', 'name email role')
    .populate('closingHistory.closedBy', 'name email role')
    .populate('cashAdded.addedBy', 'name')
    .populate('cashWithdrawn.withdrawnBy', 'name');

  if (!session) {
    throw ApiError.notFound('Cash session not found');
  }

  const sessionCashierId = ((session.cashierId as any)?._id || session.cashierId).toString();
  if (req.user?.role === UserRole.CASHIER && sessionCashierId !== req.user.id) {
    throw ApiError.forbidden('Cashiers may only review their own cash sessions');
  }

  const transactions = await Transaction.find({ cashSessionId: session._id })
    .populate('customerId', 'name phone')
    .sort({ createdAt: -1 });

  const totalCashPaidOut = transactions
    .filter((t) => t.status === 'COMPLETED')
    .reduce((acc, t) => acc + cashPaidUGX(t), 0);

  const totalCashAdded = session.cashAdded.reduce((acc, a) => acc + a.amount, 0);
  const totalCashWithdrawn = session.cashWithdrawn.reduce((acc, a) => acc + a.amount, 0);
  const expectedClosingCash =
    session.openingCash + totalCashAdded - totalCashWithdrawn - totalCashPaidOut;
  const completedTransactions = transactions.filter((transaction) => transaction.status === 'COMPLETED');
  const pendingLedgerClosing = session.openingVersion === 2 || session.ledgerVersion === 1;
  const reconciliationPreview = pendingLedgerClosing ? [] : buildReconciliationPreview(session, completedTransactions);
  const latestClosingRecord = session.closingHistory.length
    ? session.closingHistory[session.closingHistory.length - 1]
    : undefined;
  const physicalClosingRecord = latestClosingRecord?.accounts.find(
    (account) => account.accountType === 'PHYSICAL_CASH'
  );

  return ApiResponse.success(res, 'Cash session details retrieved', {
    session,
    accountBalances: await readLedgerBalances(session),
    transactions,
    totalCashPaidOut,
    totalCashAdded,
    totalCashWithdrawn,
    expectedClosingCash:
      session.status === 'CLOSED' && physicalClosingRecord
        ? physicalClosingRecord.expectedClosingBalance
        : pendingLedgerClosing ? undefined : expectedClosingCash,
    reconciliationPreview,
    latestClosingRecord,
  });
});

export const openCashSession = asyncHandler(async (req: Request, res: Response) => {
  const cashierId = req.user?.id;
  const openingCash = Number(req.body.openingCash);
  const evcOpeningBalanceUSD = Number(req.body.evcOpeningBalanceUSD);
  const mobileMoneyOpeningBalanceUSD = Number(req.body.mobileMoneyOpeningBalanceUSD);
  const mobileMoneyProvider = req.body.mobileMoneyProvider as WalletProvider;

  if (isNaN(openingCash) || openingCash < 0) {
    throw ApiError.badRequest('Opening cash (UGX) must be a non-negative whole amount');
  }

  const existing = await CashSession.findOne({ cashierId, status: 'OPEN' });

  if (existing) {
    throw ApiError.badRequest('You already have an open cash session. Please close it first.');
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  const sessionNumber = `CS-${dateStr}-${randomSuffix}`;
  const sessionId = new Types.ObjectId();
  const cashierObjectId = new Types.ObjectId(cashierId);
  const openedAt = new Date();

  const session = await CashSession.create({
    _id: sessionId,
    cashierId,
    activeShiftKey: cashierId,
    ...(useLedgerIntegration() ? { ledgerVersion: 1, accountOpenings: [
      { id: 'CASH_UGX', name: 'Shilling Cash', kind: 'CASH', currency: 'UGX', amount: openingCash },
      { id: WalletProvider.HORMUUD_EVC_PLUS, name: 'Hormuud', kind: 'WALLET', currency: 'USD', amount: evcOpeningBalanceUSD },
      { id: mobileMoneyProvider, name: mobileMoneyProvider, kind: 'WALLET', currency: 'USD', amount: mobileMoneyOpeningBalanceUSD },
    ] } : {}),
    sessionNumber,
    currency: 'UGX',
    openingCash,
    openingBalances: createOpeningBalances({
      cashSessionId: sessionId,
      cashierId: cashierObjectId,
      createdBy: cashierObjectId,
      openedAt,
      openingCashUGX: openingCash,
      evcOpeningBalanceUSD,
      mobileMoneyOpeningBalanceUSD,
      mobileMoneyProvider,
    }),
    closingCashSystem: openingCash,
    openedAt,
    notes: req.body.notes,
  });

  await AuditLog.create({
    userId: req.user?.id,
    userName: req.user?.name,
    userRole: req.user?.role,
    action: 'OPENING_BALANCES_RECORDED',
    resource: 'cash-sessions',
    resourceId: String(session._id),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details: { openingBalances: session.openingBalances },
  });

  return ApiResponse.created(res, 'Cash session opened successfully', session);
});

export const addCashToSession = asyncHandler(async (req: Request, res: Response) => {
  if (useLedgerIntegration()) return ApiResponse.success(res, 'Cash addition recorded in ledger', await postLegacyFinancialRequest(req, 'CASH_ADDED'));
  await rejectExpandedLegacyWrite(req.user?.id);
  const cashierId = req.user?.id;
  const amount = Number(req.body.amount);

  if (isNaN(amount) || amount <= 0) {
    throw ApiError.badRequest('Cash added (UGX) must be a positive whole amount');
  }

  const session = await CashSession.findOne({ cashierId, status: 'OPEN' });

  if (!session) {
    throw ApiError.badRequest('No active open cash session found');
  }

  session.cashAdded.push({
    amount,
    reason: req.body.reason,
    addedBy: cashierId as any,
    createdAt: new Date(),
  });

  await session.save();
  return ApiResponse.success(res, 'Cash added to session successfully', session);
});

export const withdrawCashFromSession = asyncHandler(async (req: Request, res: Response) => {
  if (useLedgerIntegration()) return ApiResponse.success(res, 'Cash withdrawal recorded in ledger', await postLegacyFinancialRequest(req, 'CASH_WITHDRAWN'));
  await rejectExpandedLegacyWrite(req.user?.id);
  const cashierId = req.user?.id;
  const amount = Number(req.body.amount);

  if (isNaN(amount) || amount <= 0) {
    throw ApiError.badRequest('Cash withdrawn (UGX) must be a positive whole amount');
  }

  const session = await CashSession.findOne({ cashierId, status: 'OPEN' });

  if (!session) {
    throw ApiError.badRequest('No active open cash session found');
  }

  session.cashWithdrawn.push({
    amount,
    reason: req.body.reason,
    withdrawnBy: cashierId as any,
    createdAt: new Date(),
  });

  await session.save();
  return ApiResponse.success(res, 'Cash withdrawn from session successfully', session);
});

export const closeCashSession = asyncHandler(async (req: Request, res: Response) => {
  const cashierId = req.user?.id;
  const actualBalances = req.body.actualBalances as ActualBalanceInput[];
  const session = await CashSession.findOne({ cashierId }).sort({ openedAt: -1 });

  if (!session) {
    throw ApiError.badRequest('No cash session found to close');
  }
  assertOpenSessionModification(session.status, session.cashierId.toString(), String(cashierId));
  if (session.openingVersion === 2 || session.ledgerVersion === 1) throw ApiError.badRequest('Closing is blocked on the legacy endpoint. Use ledger shift closing.');

  const transactions = await Transaction.find({
    cashSessionId: session._id,
    status: 'COMPLETED',
  });

  const preview = buildReconciliationPreview(session, transactions);
  let reconciliations;
  try {
    reconciliations = reconcileAccounts(preview, actualBalances);
  } catch (error) {
    throw ApiError.badRequest(error instanceof Error ? error.message : 'Invalid actual closing balances');
  }

  const physicalCash = reconciliations.find((account) => account.accountType === 'PHYSICAL_CASH');
  if (!physicalCash) {
    throw ApiError.badRequest('Physical Cash reconciliation is required');
  }

  const closedAt = new Date();
  const closingRecord = {
    closedAt,
    closedBy: new Types.ObjectId(cashierId),
    accounts: reconciliations,
    notes: req.body.notes,
  };
  const fieldsToSet: Record<string, unknown> = {
    status: 'CLOSED',
    closingCashSystem: physicalCash.expectedClosingBalance,
    closingCashActual: physicalCash.actualClosingBalance,
    discrepancy: physicalCash.difference,
    closedAt,
  };
  if (req.body.notes) fieldsToSet.notes = req.body.notes;

  // The OPEN predicate makes duplicate/concurrent closing attempts atomic: only
  // the first request can append a reconciliation record and close the shift.
  const closedSession = await CashSession.findOneAndUpdate(
    { _id: session._id, status: 'OPEN' },
    { $set: fieldsToSet, $unset: { activeShiftKey: 1 }, $push: { closingHistory: closingRecord } },
    { new: true, runValidators: true }
  );
  if (!closedSession) {
    throw ApiError.badRequest('This cash session has already been closed');
  }

  await AuditLog.create({
    userId: req.user?.id,
    userName: req.user?.name,
    userRole: req.user?.role,
    action: 'SHIFT_CLOSED_RECONCILED',
    resource: 'cash-sessions',
    resourceId: String(closedSession._id),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details: {
      sessionNumber: closedSession.sessionNumber,
      closedAt,
      accounts: reconciliations.map((account) => ({
        accountId: account.accountId,
        accountType: account.accountType,
        provider: account.provider,
        currency: account.currency,
        expectedClosingBalance: account.expectedClosingBalance,
        actualClosingBalance: account.actualClosingBalance,
        difference: account.difference,
        status: account.status,
      })),
    },
  });

  return ApiResponse.success(res, 'Cash session closed and reconciled successfully', closedSession);
});

export const getLedgerClose = asyncHandler(async (req: Request, res: Response) =>
  ApiResponse.success(res, 'Verified closing balances', await previewLedgerClose(req.params.id, req.user!)));

export const confirmLedgerClose = asyncHandler(async (req: Request, res: Response) => {
  const input = ledgerCloseInput.safeParse(req.body);
  if (!input.success) throw ApiError.badRequest('Enter a valid actual balance for each account and reload the closing preview if needed.');
  return ApiResponse.success(res, 'Shift closed and reconciled', await closeLedgerShift(req.params.id, req.user!, input.data));
});

export const reopenCashSession = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const session = await CashSession.findById(id);

  if (!session) {
    throw ApiError.notFound('Cash session not found');
  }

  if (session.openingVersion === 2 || session.ledgerVersion === 1) {
    return ApiResponse.success(res, 'Ledger shift reopened', await reopenLedgerShift(id, req.user!));
  }

  if (session.status === 'OPEN') {
    throw ApiError.badRequest('Session is already open');
  }

  // Check if cashier already has another open session
  const activeSession = await CashSession.findOne({ cashierId: session.cashierId, status: 'OPEN' });
  if (activeSession) {
    throw ApiError.badRequest('The cashier already has another active open cash session.');
  }

  session.status = 'OPEN';
  session.activeShiftKey = session.cashierId.toString();
  session.closedAt = undefined;
  session.closingCashActual = undefined;
  session.discrepancy = 0;
  await session.save();

  await AuditLog.create({
    userId: req.user?.id,
    userName: req.user?.name,
    userRole: req.user?.role,
    action: 'SHIFT_REOPENED',
    resource: 'cash-sessions',
    resourceId: String(session._id),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details: {
      sessionNumber: session.sessionNumber,
      preservedClosingRecords: session.closingHistory.length,
    },
  });

  return ApiResponse.success(res, 'Cash session reopened successfully', session);
});

export const getCashSessionsList = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const [sessions, total] = await Promise.all([
    CashSession.find()
      .populate([
        { path: 'cashierId', select: 'name email role' },
        { path: 'openingBalances.cashierId', select: 'name email role' },
        { path: 'openingBalances.createdBy', select: 'name email role' },
        { path: 'closingHistory.closedBy', select: 'name email role' },
      ])
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }),
    CashSession.countDocuments(),
  ]);

  return ApiResponse.success(res, 'Cash sessions list retrieved', sessions, 200, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
});
