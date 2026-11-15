import mongoose, { ClientSession, Types } from 'mongoose';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FinancialOperation } from '../models/FinancialOperation';
import { CashSession } from '../models/CashSession';
import { ExchangeRate } from '../models/ExchangeRate';
import { CustomerDeposit } from '../models/CustomerDeposit';
import { InternetCredit } from '../models/InternetCredit';
import { Expense } from '../models/Expense';
import { AuditLog } from '../models/AuditLog';
import { applyCustomerDepositMovement } from './customerDeposit.service';
import { applyInternetCreditPayment } from './internetCredit.service';
import { accountBalanceMinor, Flow, flows, minorUnits, MovementLeg, operationSchema, quoteMovement, reverseLegs } from './movementMath.service';
import { AuthenticatedUser } from '../middlewares/auth';
import { ApiError } from '../utils/ApiError';
import { UserRole } from '../constants/roles';
import { env } from '../config/env';
import { isExpandedLedgerEnabled } from '../config/features';
import { Transaction } from '../models/Transaction';
import { Customer } from '../models/Customer';

const monetaryInput = <T>(fn: () => T): T => {
  try { return fn(); }
  catch (error) { throw ApiError.badRequest(error instanceof Error ? error.message : 'Invalid financial input'); }
};

export const assertLedgerActor = (actor: AuthenticatedUser, shift: { cashierId: unknown; status: string; openingVersion?: number; ledgerVersion?: number }) => {
  if (![UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER].includes(actor.role)) throw ApiError.forbidden();
  if (String(shift.cashierId) !== actor.id) throw ApiError.forbidden('Post movements only in your own shift');
  if (shift.status !== 'OPEN') throw ApiError.badRequest('Shift is closed');
  if (shift.ledgerVersion !== 1) throw ApiError.badRequest('This shift predates complete movement capture; historical movements must not be fabricated');
};

export const fingerprint = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const assertRetry = (event: any, hash: string) => {
  if (event.fingerprint !== hash) throw ApiError.badRequest('Request key was already used for different data');
  return event;
};

// Production is gated at both routes and handlers. Indexes must exist before
// transactions begin. No fallback to non-atomic writes is permitted.
export const atomicLedgerRequest = async (actor: AuthenticatedUser, requestKey: string, hash: string,
  work: (session: ClientSession) => Promise<any>) => {
  await Promise.all([FinancialOperation.init(), CustomerDeposit.init(), InternetCredit.init(), Expense.init(), AuditLog.init(), Transaction.init(), Customer.init()]);
  const indexes = await FinancialOperation.listIndexes();
  if (![
    (key: any) => key.cashierId === 1 && key.requestKey === 1,
    (key: any) => key.reversesOperationId === 1,
    (key: any) => key.referenceKey === 1,
  ].every(matches => indexes.some(index => index.unique === true && matches(index.key)))) {
    throw ApiError.internal('Financial ledger unique indexes are unavailable; posting is blocked');
  }
  const session = await mongoose.startSession();
  let result: any;
  try {
    await session.withTransaction(async () => {
      const existing = await FinancialOperation.findOne({ cashierId: actor.id, requestKey }).session(session);
      if (existing) { result = assertRetry(existing, hash); return; }
      result = await work(session);
    });
    return result;
  } catch (error: any) {
    if (error.code === 11000) {
      const previous = await FinancialOperation.findOne({ cashierId: actor.id, requestKey });
      if (previous) return assertRetry(previous, hash);
      throw ApiError.badRequest('Duplicate financial reference or reversal');
    }
    throw error;
  } finally { await session.endSession(); }
};

const lockShift = async (id: string, actor: AuthenticatedUser, session: ClientSession, managementCorrection = false) => {
  const shift = await CashSession.findById(id).session(session);
  if (!shift) throw ApiError.notFound('Shift not found');
  assertLedgerActor(managementCorrection && actor.role !== UserRole.CASHIER ? { ...actor, id: String(shift.cashierId) } : actor, shift);
  // Serialize balance checks and postings per shift, including different accounts.
  const locked = await CashSession.updateOne({ _id: shift._id, status: 'OPEN', cashierId: shift.cashierId }, { $inc: { movementRevision: 1 } }, { session });
  if (locked.matchedCount !== 1) throw ApiError.badRequest('Shift changed while posting; retry');
  return shift;
};

const validateFunds = async (shift: any, proposed: MovementLeg[], session: ClientSession) => {
  const events = await FinancialOperation.find({ shiftId: shift._id }).session(session);
  const prior = events.flatMap(event => event.legs as MovementLeg[]);
  for (const id of new Set(proposed.map(leg => leg.accountId))) {
    const account = shift.accountOpenings?.find((a: any) => a.id === id);
    if (!account) throw ApiError.badRequest('Account was not opened in this shift');
    if (accountBalanceMinor(account.amount, account, [...prior, ...proposed]) < 0) throw ApiError.badRequest(`Insufficient ${account.currency} balance in ${account.name}`);
  }
};

export const postAccountOperation = async (actor: AuthenticatedUser, raw: unknown, requestIdentity?: unknown) => {
  if (!isExpandedLedgerEnabled()) throw ApiError.notFound('Expanded account operations are development only');
  const input = operationSchema.parse(raw);
  const hash = fingerprint(requestIdentity ?? input);
  return atomicLedgerRequest(actor, input.requestKey, hash, async session => {
    const shift = await lockShift(input.shiftId, actor, session);
    const account = shift.accountOpenings?.find(a => a.id === input.accountId);
    if (!account) throw ApiError.badRequest('Incoming account was not opened in this shift');
    const occurredAt = new Date(), operationId = new Types.ObjectId();
    let legs: MovementLeg[], feeUSD = 0, feeUGX = 0, exchangeRate: any;
    let recordId: any, transactionId: any;
    if ((flows as readonly string[]).includes(input.category)) {
      if (!['WALLET_USD_TO_CASH_UGX', 'CASH_USD_TO_CASH_UGX'].includes(input.category)) {
        throw ApiError.badRequest('This flow is deferred until its fee requirements are confirmed');
      }
      const outgoing = shift.accountOpenings?.find(a => a.id === input.outgoingAccountId);
      if (!outgoing) throw ApiError.badRequest('Outgoing account was not opened in this shift');
      const rate = await ExchangeRate.findOne({ _id: input.exchangeRateId, status: 'ACTIVE', baseCurrency: 'USD', targetCurrency: 'UGX' }).session(session);
      if (!rate) throw ApiError.badRequest('Review the current authorized exchange rate');
      exchangeRate = { rateId: rate._id, rate: rate.rate, baseCurrency: 'USD', targetCurrency: 'UGX' };
      const quote = monetaryInput(() => quoteMovement(input.category as Flow, account, outgoing, input.amount, rate.rate));
      ({ legs, feeUSD, feeUGX } = quote);
      let customer = input.customerId ? await Customer.findById(input.customerId).session(session) : null;
      if (input.customerId && !customer) throw ApiError.notFound('Customer not found');
      if (!customer && input.phone && input.customerName) {
        customer = await Customer.findOne({ phone: input.phone }).session(session);
        if (!customer) customer = new Customer({ name: input.customerName, phone: input.phone, customerNumber: `CUS-${new Types.ObjectId()}` });
      }
      if (customer?.status === 'BLOCKED') throw ApiError.badRequest('Customer is blocked');
      const [transaction] = await Transaction.create([{
        operationId, flow: input.category, transactionNumber: `TXN-${operationId}`, cashSessionId: shift._id,
        customerId: customer?._id, customerPhone: customer?.phone, walletProvider: account.id,
        amountReceivedUSD: input.amount, serviceFeeUSD: feeUSD, serviceFeeUGX: feeUGX,
        feeRatePercent: 1, exchangeableAmountUSD: input.amount - feeUSD, exchangeRateUGX: rate.rate,
        cashPaidUGX: quote.legs[1].amountMinor, profitUSD: feeUSD,
        referenceNumber: input.reference, cashierId: actor.id, status: 'COMPLETED', notes: input.reason,
      }], { session });
      transactionId = transaction._id;
      if (customer) {
        customer.stats.totalTransactions += 1;
        customer.stats.totalAmountExchanged += input.amount;
        customer.stats.totalProfitGenerated += feeUSD;
        customer.stats.averageTransactionAmount = customer.stats.totalAmountExchanged / customer.stats.totalTransactions;
        customer.stats.lastVisitAt = occurredAt;
        await customer.save({ session });
      }
    } else {
      if (!input.reason) throw ApiError.badRequest('A movement reason is required');
      if (input.category === 'ADJUSTMENT' && actor.role === UserRole.CASHIER) throw ApiError.forbidden('Manager/Admin authorization required for adjustments');
      if (['CASH_ADDED', 'CASH_WITHDRAWN', 'ADJUSTMENT', 'EXPENSE'].includes(input.category) && account.kind !== 'CASH') throw ApiError.badRequest('Select a cash account');
      if (['CUSTOMER_DEPOSIT', 'CUSTOMER_WITHDRAWAL', 'CREDIT_REPAYMENT'].includes(input.category) && account.id !== 'CASH_UGX') throw ApiError.badRequest('Customer UGX movements require Shilling Cash');
      const direction = input.category === 'ADJUSTMENT' ? input.direction :
        ['CASH_WITHDRAWN', 'EXPENSE', 'CUSTOMER_WITHDRAWAL'].includes(input.category) ? 'OUT' : 'IN';
      if (!direction) throw ApiError.badRequest('Adjustment direction is required');
      legs = [{ accountId: account.id, currency: account.currency, direction, amountMinor: monetaryInput(() => minorUnits(input.amount, account.currency)) }];
      if (input.category === 'CUSTOMER_DEPOSIT' || input.category === 'CUSTOMER_WITHDRAWAL') {
        let record = input.recordId ? await CustomerDeposit.findById(input.recordId).session(session) : null;
        if (!record && input.category === 'CUSTOMER_DEPOSIT' && !input.recordId && input.customerName && input.phone) {
          record = await CustomerDeposit.findOne({ phone: input.phone }).session(session);
          if (!record) record = new CustomerDeposit({ customerName: input.customerName, phone: input.phone, createdBy: actor.id });
        }
        if (!record) throw ApiError.notFound('Select an existing customer deposit profile or supply name and phone for a new deposit');
        applyCustomerDepositMovement(record, { type: input.category === 'CUSTOMER_DEPOSIT' ? 'DEPOSIT' : 'WITHDRAWAL', amountUGX: input.amount,
          recordedBy: new Types.ObjectId(actor.id), occurredAt, notes: input.reason, operationId });
        await record.save({ session }); recordId = record._id;
      }
      if (input.category === 'CREDIT_REPAYMENT') {
        const record = input.recordId ? await InternetCredit.findById(input.recordId).session(session) : null;
        if (!record) throw ApiError.notFound('Internet credit record not found');
        applyInternetCreditPayment(record, { amountUGX: input.amount, recordedBy: new Types.ObjectId(actor.id), paidAt: occurredAt, notes: input.reason, operationId });
        await record.save({ session }); recordId = record._id;
      }
      if (input.category === 'EXPENSE') {
        const [record] = await Expense.create([{ title: input.reason, amount: input.amount, category: input.expenseCategory ?? 'MISC', notes: input.expenseNotes,
          cashSessionId: shift._id, recordedBy: actor.id, accountId: account.id, currency: account.currency, operationId }], { session });
        recordId = record._id;
      }
    }
    await validateFunds(shift, legs!, session);
    const [event] = await FinancialOperation.create([{ _id: operationId, cashierId: actor.id, recordedBy: actor.id, shiftId: shift._id,
      requestKey: input.requestKey, fingerprint: hash, category: input.category, occurredAt,
      reference: input.reference, referenceKey: `${shift._id}:${input.accountId}:${input.reference}`,
      reason: input.reason, recordId, transactionId, exchangeRate, feeUSD, feeUGX, legs: legs! }], { session });
    await AuditLog.create([{ userId: actor.id, userName: actor.name, userRole: actor.role, action: 'ACCOUNT_OPERATION_POSTED',
      resource: 'financial-operations', resourceId: String(event._id), details: { category: event.category, shiftId: String(shift._id), legs: legs!, feeUSD, feeUGX } }], { session });
    return event;
  });
};

export const reverseAccountOperation = async (actor: AuthenticatedUser, raw: unknown) => {
  if (!isExpandedLedgerEnabled()) throw ApiError.notFound('Expanded account operations are development only');
  const input = z.object({ requestKey: z.string().min(8).max(100), operationId: z.string().regex(/^[a-f\d]{24}$/i), reason: z.string().trim().min(3).max(500) }).strict().parse(raw);
  return atomicLedgerRequest(actor, input.requestKey, fingerprint(input), async session => {
    const original = await FinancialOperation.findById(input.operationId).session(session);
    if (!original) throw ApiError.notFound('Financial operation not found');
    const shift = await lockShift(String(original.shiftId), actor, session, true);
    if (original.reversesOperationId) throw ApiError.badRequest('Cannot reverse a reversal');
    const domainCorrection = ['CUSTOMER_DEPOSIT', 'CUSTOMER_WITHDRAWAL', 'CREDIT_REPAYMENT', 'EXPENSE'].includes(original.category);
    if (domainCorrection && actor.role === UserRole.CASHIER) throw ApiError.forbidden('Manager/Admin authorization is required for business-ledger corrections');
    if (original.category === 'ADJUSTMENT' && actor.role === UserRole.CASHIER) throw ApiError.forbidden();
    if (actor.role === UserRole.CASHIER && Date.now() - original.occurredAt.getTime() > 30 * 60000) throw ApiError.forbidden('Cashier reversal window has expired');
    if (await FinancialOperation.exists({ reversesOperationId: original._id }).session(session)) throw ApiError.badRequest('Operation has already been reversed');
    const legs = reverseLegs(original.legs as MovementLeg[]);
    const operationId = new Types.ObjectId();
    await validateFunds(shift, legs, session);
    if (original.category === 'CUSTOMER_DEPOSIT' || original.category === 'CUSTOMER_WITHDRAWAL') {
      const record = await CustomerDeposit.findById(original.recordId).session(session);
      if (!record) throw ApiError.notFound('Deposit profile not found');
      applyCustomerDepositMovement(record, { type: original.category === 'CUSTOMER_DEPOSIT' ? 'WITHDRAWAL' : 'DEPOSIT',
        amountUGX: original.legs[0].amountMinor, recordedBy: new Types.ObjectId(actor.id), notes: input.reason, operationId, reversesOperationId: original._id });
      await record.save({ session });
    }
    if (original.category === 'CREDIT_REPAYMENT') {
      const record = await InternetCredit.findById(original.recordId).session(session);
      const amount = original.legs[0].amountMinor;
      if (!record || record.amountPaidUGX < amount) throw ApiError.badRequest('Credit balance cannot support this reversal');
      record.amountPaidUGX -= amount;
      record.remainingBalanceUGX = record.originalAmountUGX - record.amountPaidUGX;
      record.status = record.amountPaidUGX === 0 ? 'UNPAID' : record.remainingBalanceUGX === 0 ? 'PAID' : 'PARTIALLY_PAID';
      record.payments.push({ amountUGX: amount, paidAt: new Date(), recordedBy: new Types.ObjectId(actor.id),
        kind: 'REVERSAL', operationId, reversesOperationId: original._id, notes: input.reason, balanceAfterPaymentUGX: record.remainingBalanceUGX });
      await record.save({ session });
    }
    if (original.category === 'EXPENSE') {
      const expense = await Expense.findById(original.recordId).session(session);
      if (!expense) throw ApiError.notFound('Expense not found');
      expense.reversedAt = new Date();
      expense.reversalReason = input.reason;
      await expense.save({ session });
    }
    if (original.transactionId) {
      const transaction = await Transaction.findById(original.transactionId).session(session);
      if (!transaction || transaction.status !== 'COMPLETED') throw ApiError.badRequest('Linked transaction is missing or no longer completed');
      transaction.status = 'CANCELLED'; transaction.cancelledAt = new Date();
      transaction.cancelledBy = new Types.ObjectId(actor.id); transaction.cancellationReason = input.reason;
      await transaction.save({ session });
      if (transaction.customerId) {
        const customer = await Customer.findById(transaction.customerId).session(session);
        if (customer) {
          customer.stats.totalTransactions = Math.max(0, customer.stats.totalTransactions - 1);
          customer.stats.totalAmountExchanged = Math.max(0, customer.stats.totalAmountExchanged - transaction.amountReceivedUSD);
          customer.stats.totalProfitGenerated = Math.max(0, customer.stats.totalProfitGenerated - transaction.serviceFeeUSD);
          customer.stats.averageTransactionAmount = customer.stats.totalTransactions ? customer.stats.totalAmountExchanged / customer.stats.totalTransactions : 0;
          await customer.save({ session });
        }
      }
    }
    const [event] = await FinancialOperation.create([{ _id: operationId, cashierId: actor.id, recordedBy: actor.id, shiftId: original.shiftId,
      requestKey: input.requestKey, fingerprint: fingerprint(input), reference: String(original._id), category: 'REVERSAL',
      reversesOperationId: original._id, reason: input.reason, occurredAt: new Date(), legs,
      recordId: original.recordId, transactionId: original.transactionId,
      exchangeRate: original.exchangeRate, feeUSD: -original.feeUSD, feeUGX: -original.feeUGX }], { session });
    await AuditLog.create([{ userId: actor.id, userName: actor.name, userRole: actor.role, action: 'ACCOUNT_OPERATION_REVERSED',
      resource: 'financial-operations', resourceId: String(event._id), details: { originalOperationId: String(original._id), reason: input.reason } }], { session });
    return event;
  });
};
