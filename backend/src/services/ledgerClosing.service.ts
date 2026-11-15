import mongoose, { ClientSession, Types } from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env';
import { isExpandedLedgerEnabled } from '../config/features';
import { UserRole } from '../constants/roles';
import { AuthenticatedUser } from '../middlewares/auth';
import { AuditLog } from '../models/AuditLog';
import { CashSession, ICashSession, IConfirmedMovement } from '../models/CashSession';
import { FinancialOperation } from '../models/FinancialOperation';
import { Transaction } from '../models/Transaction';
import { ApiError } from '../utils/ApiError';
import { accountBalanceMinor, minorUnits, MovementLeg } from './movementMath.service';
import { assertOpenSessionModification, reconciliationStatus } from './reconciliation.service';

const supportedExchange = ['WALLET_USD_TO_CASH_UGX', 'CASH_USD_TO_CASH_UGX'];
const singleMovements = new Map<string, 'IN' | 'OUT' | 'EITHER'>([
  ['CASH_ADDED', 'IN'], ['CASH_WITHDRAWN', 'OUT'], ['ADJUSTMENT', 'EITHER'], ['EXPENSE', 'OUT'],
  ['CUSTOMER_DEPOSIT', 'IN'], ['CUSTOMER_WITHDRAWAL', 'OUT'], ['CREDIT_REPAYMENT', 'IN'],
]);
const fail = (reason: string): never => { throw ApiError.badRequest(reason); };
const units = (amount: number, currency: 'USD' | 'UGX', reason: string) => {
  try { return minorUnits(amount, currency); } catch { return fail(reason); }
};
const factor = (currency: string) => currency === 'USD' ? 100 : 1;
const revisionToken = (shift: ICashSession) => `${shift.movementRevision ?? 0}:${shift.closingHistory?.length ?? 0}`;

export function ledgerClosingBlocker(shift: ICashSession): string | undefined {
  if (!isExpandedLedgerEnabled()) return 'Ledger closing is not enabled in this environment.';
  if (shift.openingVersion !== 2) return 'This shift has no complete opening snapshot for USD Cash and UGX Cash.';
  if (shift.ledgerVersion !== 1) return 'This shift predates verified movement capture.';
  if (shift.status !== 'OPEN') return 'This shift is already closed.';
  return undefined;
}

export async function buildLedgerClosingPreview(shift: ICashSession, session?: ClientSession) {
  const blocker = ledgerClosingBlocker(shift);
  if (blocker) fail(blocker);
  const openings = shift.accountOpenings ?? [];
  const byAccount = new Map(openings.map(account => [account.id, account]));
  if (openings.length < 2 || byAccount.size !== openings.length ||
      byAccount.get('CASH_USD')?.currency !== 'USD' || byAccount.get('CASH_USD')?.kind !== 'CASH' ||
      byAccount.get('CASH_UGX')?.currency !== 'UGX' || byAccount.get('CASH_UGX')?.kind !== 'CASH' ||
      byAccount.get('CASH_UGX')?.amount !== shift.openingCash ||
      openings.some(a => !a.id || !a.name || !['CASH', 'WALLET'].includes(a.kind) ||
        !['UGX', 'USD'].includes(a.currency) || (a.kind === 'WALLET' && a.currency !== 'USD'))) {
    fail('The recorded opening accounts are missing or inconsistent.');
  }
  if (shift.cashAdded?.length || shift.cashWithdrawn?.length) fail('This shift contains cash adjustments outside the ledger.');
  const events = await FinancialOperation.find({ shiftId: shift._id }).sort({ occurredAt: 1, _id: 1 }).session(session ?? null).lean();
  const transactions = await Transaction.find({ cashSessionId: shift._id }).session(session ?? null).lean();
  if (events.length !== (shift.movementRevision ?? 0)) fail('The shift movement count does not match its ledger. Review missing or extra entries.');
  const eventById = new Map(events.map(event => [String(event._id), event]));
  const transactionById = new Map(transactions.map(tx => [String(tx._id), tx]));
  const adjustments = events.filter(event => event.category === 'ADJUSTMENT');
  if (adjustments.length) {
    const approvals = await AuditLog.find({ resource: 'financial-operations', action: 'ACCOUNT_OPERATION_POSTED',
      resourceId: { $in: adjustments.map(event => String(event._id)) }, userRole: { $in: [UserRole.ADMIN, UserRole.MANAGER] } })
      .session(session ?? null).lean();
    if (adjustments.some(event => !approvals.some(audit =>
      audit.resourceId === String(event._id) && String(audit.userId) === String(event.recordedBy)))) {
      fail('A cash adjustment has no matching administrator or manager audit record.');
    }
  }
  const reversed = new Set<string>();
  const legsByAccount = new Map<string, { legs: MovementLeg[]; groups: Map<string, IConfirmedMovement> }>();
  for (const event of events) {
    if (!event.recordedBy || !event.reference || !event.occurredAt || event.occurredAt < shift.openedAt || !event.legs?.length) {
      fail('A ledger movement has incomplete recording information.');
    }
    for (const leg of event.legs) {
      if (byAccount.get(leg.accountId)?.currency !== leg.currency ||
          !['IN', 'OUT'].includes(leg.direction) || !Number.isSafeInteger(leg.amountMinor) || leg.amountMinor <= 0) {
        fail('A ledger movement has an unknown account, wrong currency, or invalid amount.');
      }
    }
    const isExchange = supportedExchange.includes(event.category);
    if (event.category === 'REVERSAL') {
      const originalId = String(event.reversesOperationId);
      const original = eventById.get(originalId);
      if (!original || original.category === 'REVERSAL' || reversed.has(originalId) || !event.reason ||
          event.occurredAt < original.occurredAt || event.legs.length !== original.legs.length ||
          String(event.transactionId ?? '') !== String(original.transactionId ?? '') ||
          original.legs.some((leg, index) => {
            const offset = event.legs[index];
            return offset.accountId !== leg.accountId || offset.currency !== leg.currency ||
              offset.amountMinor !== leg.amountMinor || offset.direction === leg.direction;
          })) fail('A reversal cannot be matched to its original ledger movements.');
      reversed.add(originalId);
    } else if (isExchange) {
      const receipt = event.legs.find(leg => leg.direction === 'IN');
      const payout = event.legs.find(leg => leg.direction === 'OUT');
      const tx = transactionById.get(String(event.transactionId));
      if (event.legs.length !== 2 || receipt?.currency !== 'USD' || payout?.accountId !== 'CASH_UGX' ||
          (event.category === supportedExchange[0] ? byAccount.get(receipt.accountId)?.kind !== 'WALLET' : receipt.accountId !== 'CASH_USD') ||
          !event.exchangeRate?.rateId || !Number.isFinite(event.exchangeRate.rate) || event.exchangeRate.rate! <= 0 ||
          !tx || String(tx.operationId) !== String(event._id) || tx.walletProvider !== receipt.accountId ||
          tx.exchangeRateUGX !== event.exchangeRate.rate || tx.serviceFeeUSD !== event.feeUSD || tx.serviceFeeUGX !== event.feeUGX ||
          units(tx.amountReceivedUSD, 'USD', 'A linked exchange has an invalid USD receipt.') !== receipt.amountMinor ||
          tx.cashPaidUGX !== payout.amountMinor) fail('An exchange is missing its verified transaction, rate, or matching ledger movements.');
    } else {
      const direction = singleMovements.get(event.category);
      const leg = event.legs[0];
      if (!direction || event.legs.length !== 1 || !event.reason ||
          byAccount.get(leg.accountId)?.kind !== 'CASH' ||
          (['CUSTOMER_DEPOSIT', 'CUSTOMER_WITHDRAWAL', 'CREDIT_REPAYMENT'].includes(event.category) && leg.accountId !== 'CASH_UGX') ||
          (direction !== 'EITHER' && leg.direction !== direction)) fail('The shift contains an unsupported or invalid movement.');
    }
    for (const leg of event.legs) {
      const entry = legsByAccount.get(leg.accountId) ?? { legs: [], groups: new Map<string, IConfirmedMovement>() };
      legsByAccount.set(leg.accountId, entry);
      entry.legs.push(leg as MovementLeg);
      const movementType = (isExchange ? 'EXCHANGE' : event.category) as IConfirmedMovement['movementType'];
      const key = `${movementType}:${leg.direction}`;
      const group = entry.groups.get(key) ?? { movementType, direction: leg.direction, currency: leg.currency, amount: 0, transactionCount: 0 };
      group.amount += leg.amountMinor;
      if (!Number.isSafeInteger(group.amount)) fail('Movement totals exceed supported precision.');
      group.transactionCount++;
      entry.groups.set(key, group);
    }
  }
  for (const tx of transactions) {
    const event = eventById.get(String(tx.operationId));
    if (!event || !supportedExchange.includes(event.category) || String(event.transactionId) !== String(tx._id) ||
        tx.status !== (reversed.has(String(event._id)) ? 'CANCELLED' : 'COMPLETED')) {
      fail('A transaction on this shift is not fully linked to its ledger posting and reversal history.');
    }
  }
  return {
    revision: revisionToken(shift),
    accounts: openings.map(account => {
      const entry = legsByAccount.get(account.id);
      let expectedMinor: number;
      try { expectedMinor = accountBalanceMinor(account.amount, account, entry?.legs ?? []); }
      catch { return fail(`Recorded balance for ${account.name} cannot be calculated safely.`); }
      if (expectedMinor < 0) fail(`Recorded movements leave a negative balance in ${account.name}.`);
      const scale = factor(account.currency);
      if (units(expectedMinor / scale, account.currency, 'Expected closing amount exceeds supported precision.') !== expectedMinor) {
        fail('Expected closing amount exceeds supported precision.');
      }
      return {
        accountId: account.id, accountName: account.name, currency: account.currency,
        accountType: account.id === 'CASH_UGX' ? 'PHYSICAL_CASH' as const : account.kind === 'CASH' ? 'LEDGER_CASH' as const : 'LEDGER_WALLET' as const,
        provider: account.id === 'CASH_UGX' ? 'CASH_DRAWER' : account.id, openingBalance: account.amount,
        expectedClosingBalance: expectedMinor / scale,
        confirmedMovements: [...(entry?.groups.values() ?? [])].map(item => ({ ...item, amount: item.amount / scale })),
      };
    }),
  };
}

export async function ledgerClosingEligibility(shift: ICashSession) {
  try { await buildLedgerClosingPreview(shift); return { ready: true }; }
  catch (error) {
    if (error instanceof ApiError && error.statusCode === 400) return { ready: false, reason: error.message };
    throw error;
  }
}

export const ledgerCloseInput = z.object({
  revision: z.string().regex(/^\d+:\d+$/),
  actualBalances: z.array(z.object({ accountId: z.string().min(1).max(64), amount: z.number().finite().nonnegative() }).strict()).min(2).max(50),
}).strict();

async function closingShift(id: string, actor: AuthenticatedUser, session?: ClientSession) {
  if (!isExpandedLedgerEnabled()) throw ApiError.notFound();
  if (![UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER].includes(actor.role)) throw ApiError.forbidden();
  if (!/^[a-f\d]{24}$/i.test(id)) throw ApiError.badRequest('Invalid shift ID');
  const shift = await CashSession.findById(id).session(session ?? null);
  if (!shift) throw ApiError.notFound('Shift not found');
  assertOpenSessionModification(shift.status, String(shift.cashierId), actor.id);
  return shift;
}

export async function previewLedgerClose(id: string, actor: AuthenticatedUser) {
  return buildLedgerClosingPreview(await closingShift(id, actor));
}

export async function closeLedgerShift(id: string, actor: AuthenticatedUser, input: z.infer<typeof ledgerCloseInput>) {
  if (!isExpandedLedgerEnabled()) throw ApiError.notFound();
  input = ledgerCloseInput.parse(input);
  await AuditLog.init();
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const shift = await closingShift(id, actor, session);
      if (input.revision !== revisionToken(shift)) throw new ApiError(409, 'Shift movements changed. Reload closing balances and review the counts.');
      const preview = await buildLedgerClosingPreview(shift, session);
      const actuals = new Map(input.actualBalances.map(actual => [actual.accountId, actual.amount]));
      if (actuals.size !== input.actualBalances.length || actuals.size !== preview.accounts.length) fail('Enter one actual balance for each opened account.');
      const accounts = preview.accounts.map(account => {
        const actual = actuals.get(account.accountId);
        if (actual === undefined) return fail(`Enter an actual balance for ${account.accountName}.`);
        const actualMinor = units(actual, account.currency, `Enter a valid ${account.currency} amount for ${account.accountName}.`);
        const expectedMinor = units(account.expectedClosingBalance, account.currency, 'Invalid expected closing amount.');
        const difference = (actualMinor - expectedMinor) / factor(account.currency);
        return { ...account, actualClosingBalance: actual, difference, status: reconciliationStatus(difference) };
      });
      const drawer = accounts.find(account => account.accountId === 'CASH_UGX')!;
      const closedAt = new Date();
      // Every posting/reversal updates this same shift document. Concurrent writes
      // conflict with the snapshot transaction and force a revision recheck.
      const closed = await CashSession.findOneAndUpdate({ _id: shift._id, status: 'OPEN', cashierId: shift.cashierId }, {
        $set: { status: 'CLOSED', closedAt, closingCashSystem: drawer.expectedClosingBalance,
          closingCashActual: drawer.actualClosingBalance, discrepancy: drawer.difference },
        $unset: { activeShiftKey: 1 },
        $push: { closingHistory: { closedAt, closedBy: new Types.ObjectId(actor.id), accounts, movementRevision: shift.movementRevision ?? 0 } },
      }, { new: true, runValidators: true, session });
      if (!closed) throw new ApiError(409, 'This shift has already been closed.');
      await AuditLog.create([{ userId: actor.id, userName: actor.name, userRole: actor.role, action: 'SHIFT_CLOSED_RECONCILED',
        resource: 'cash-sessions', resourceId: id, details: { sessionNumber: shift.sessionNumber, closedAt, revision: preview.revision, accounts } }], { session });
      return closed;
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  } finally { await session.endSession(); }
}

export async function reopenLedgerShift(id: string, actor: AuthenticatedUser) {
  if (!isExpandedLedgerEnabled()) throw ApiError.notFound();
  if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.MANAGER) throw ApiError.forbidden();
  await AuditLog.init();
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const shift = await CashSession.findById(id).session(session);
      if (!shift) throw ApiError.notFound('Shift not found');
      if (shift.status !== 'CLOSED') fail('This shift is already open.');
      const latestClosing = shift.closingHistory.at(-1);
      if (shift.ledgerVersion !== 1 || shift.openingVersion !== 2 || !latestClosing ||
          !Number.isSafeInteger(latestClosing.movementRevision) || latestClosing.movementRevision !== shift.movementRevision) {
        fail('No verified ledger closing record is available to reopen.');
      }
      if (await CashSession.exists({ cashierId: shift.cashierId, status: 'OPEN' }).session(session)) fail('The cashier already has another open shift.');
      const reopened = await CashSession.findOneAndUpdate({ _id: id, status: 'CLOSED' }, {
        $set: { status: 'OPEN', activeShiftKey: String(shift.cashierId), discrepancy: 0 },
        $unset: { closedAt: 1, closingCashActual: 1 },
      }, { new: true, runValidators: true, session });
      if (!reopened) fail('This shift is already open.');
      await AuditLog.create([{ userId: actor.id, userName: actor.name, userRole: actor.role, action: 'SHIFT_REOPENED',
        resource: 'cash-sessions', resourceId: id, details: { sessionNumber: shift.sessionNumber, preservedClosingRecords: shift.closingHistory.length } }], { session });
      return reopened;
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  } catch (error: any) {
    if (error.code === 11000) fail('The cashier already has another open shift.');
    throw error;
  } finally { await session.endSession(); }
}
