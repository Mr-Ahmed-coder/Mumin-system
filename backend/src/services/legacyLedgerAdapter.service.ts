import { Request } from 'express';
import { env } from '../config/env';
import { isExpandedLedgerEnabled } from '../config/features';
import { CashSession } from '../models/CashSession';
import { Transaction } from '../models/Transaction';
import { ExchangeRate } from '../models/ExchangeRate';
import { CustomerDeposit } from '../models/CustomerDeposit';
import { InternetCredit } from '../models/InternetCredit';
import { Expense } from '../models/Expense';
import { fingerprint, postAccountOperation, reverseAccountOperation } from './movementLedger.service';
import { FinancialOperation } from '../models/FinancialOperation';
import { ApiError } from '../utils/ApiError';
import { ZodError } from 'zod';

async function validateOperation<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof ZodError) throw ApiError.badRequest('Invalid financial operation', error.issues);
    throw error;
  }
}

export const useLedgerIntegration = () => isExpandedLedgerEnabled();
export const requestKey = (req: Request) => {
  const raw = req.get('Idempotency-Key') || req.body?.requestKey;
  const value = typeof raw === 'string' ? raw.trim() : undefined;
  if (typeof value !== 'string' || value.length < 8 || value.length > 100) throw ApiError.badRequest('A stable Idempotency-Key is required');
  return value;
};

export const postLegacyFinancialRequest = async (req: Request, category: string) => {
  const key = requestKey(req);
  const exchange = category === 'WALLET_USD_TO_CASH_UGX';
  if (category === 'EXPENSE' && !req.body.accountId) throw ApiError.badRequest('Select the cash account used for the expense');
  const input = {
    requestKey: key, category,
    accountId: exchange ? req.body.walletProvider : req.body.accountId || 'CASH_UGX',
    outgoingAccountId: exchange ? 'CASH_UGX' : undefined,
    amount: exchange ? Number(req.body.amountReceivedUSD ?? req.body.amountReceived) : Number(req.body.amountUGX ?? req.body.amount),
    reference: req.body.referenceNumber?.trim() || req.body.reference || key,
    reason: category === 'EXPENSE' ? req.body.title : req.body.reason || req.body.notes || (exchange ? undefined : category),
    expenseCategory: category === 'EXPENSE' ? req.body.category : undefined,
    expenseNotes: category === 'EXPENSE' ? req.body.notes : undefined,
    customerId: exchange ? req.body.customerId : undefined,
    recordId: ['CUSTOMER_WITHDRAWAL', 'CREDIT_REPAYMENT'].includes(category) ? req.params.id : undefined,
    customerName: req.body.customerName, phone: req.body.phone,
  };
  const identity = { source: 'legacy', input, quotedRateId: req.body.exchangeRateId };
  const previous = await FinancialOperation.findOne({ cashierId: req.user!.id, requestKey: key });
  if (previous && previous.fingerprint !== fingerprint(identity)) throw ApiError.badRequest('Request key was already used for different data');
  const event = previous ?? await (async () => {
    const shift = await CashSession.findOne({ cashierId: req.user!.id, status: 'OPEN' });
    if (!shift || shift.ledgerVersion !== 1) throw ApiError.badRequest('Open a ledger-enabled shift. Historical shifts require a dry-run review before migration');
    const rate = exchange ? await ExchangeRate.findOne({ status: 'ACTIVE', baseCurrency: 'USD', targetCurrency: 'UGX' }) : null;
    if (exchange && req.body.exchangeRateId && String(rate?._id) !== req.body.exchangeRateId) throw ApiError.badRequest('Exchange rate changed; refresh your quote');
    return validateOperation(() => postAccountOperation(req.user!, { ...input, shiftId: String(shift._id), exchangeRateId: rate ? String(rate._id) : undefined }, identity));
  })();
  if (event.transactionId) return Transaction.findById(event.transactionId);
  if (category.startsWith('CUSTOMER_')) return CustomerDeposit.findById(event.recordId);
  if (category === 'CREDIT_REPAYMENT') return InternetCredit.findById(event.recordId);
  if (category === 'EXPENSE') return Expense.findById(event.recordId);
  return event;
};

export const cancelLegacyFinancialRequest = async (req: Request) => {
  const transaction = await Transaction.findById(req.params.id);
  if (!transaction) throw ApiError.notFound('Transaction not found');
  if (!transaction.operationId) throw ApiError.badRequest('Historical transaction has no verified ledger link; dry-run review is required before correction');
  await validateOperation(() => reverseAccountOperation(req.user!, { requestKey: requestKey(req), operationId: String(transaction.operationId), reason: req.body.cancellationReason }));
  return Transaction.findById(transaction._id);
};
