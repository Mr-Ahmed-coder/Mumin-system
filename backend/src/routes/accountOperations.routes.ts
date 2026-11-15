import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { isExpandedLedgerEnabled } from '../config/features';
import { authenticate, authorize } from '../middlewares/auth';
import { UserRole } from '../constants/roles';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { ApiResponse } from '../utils/ApiResponse';
import { CashSession } from '../models/CashSession';
import { FinancialOperation } from '../models/FinancialOperation';
import { postAccountOperation, reverseAccountOperation } from '../services/movementLedger.service';
import { accountBalanceMinor, quoteMovement } from '../services/movementMath.service';
import { ExchangeRate } from '../models/ExchangeRate';
import { z } from 'zod';
import { ledgerMigrationDryRun } from '../services/ledgerRead.service';
import { ledgerClosingEligibility } from '../services/ledgerClosing.service';

const router = Router();
router.use((_req, _res, next) => isExpandedLedgerEnabled() ? next() : next(ApiError.notFound()));
router.use(authenticate, authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER));
const validated = async (operation: () => Promise<any>) => {
  try { return await operation(); }
  catch (error) { if (error instanceof z.ZodError) throw ApiError.badRequest('Invalid account operation', error.issues); throw error; }
};
router.post('/', asyncHandler(async (req: Request, res: Response) => ApiResponse.created(res, 'Account operation posted atomically', await validated(() => postAccountOperation(req.user!, req.body)))));
router.post('/reverse', asyncHandler(async (req: Request, res: Response) => ApiResponse.created(res, 'Reversal recorded; original movements preserved', await validated(() => reverseAccountOperation(req.user!, req.body)))));
router.get('/migration/dry-run', authorize(UserRole.ADMIN), asyncHandler(async (_req: Request, res: Response) =>
  ApiResponse.success(res, 'Read-only migration inventory; no records were imported', await ledgerMigrationDryRun())));
router.post('/quote', asyncHandler(async (req: Request, res: Response) => {
  const input = await validated(async () => z.object({
    shiftId: z.string().regex(/^[a-f\d]{24}$/i), accountId: z.string(), amount: z.number().positive().finite(),
  }).strict().parse(req.body));
  const shift = await CashSession.findOne({ _id: input.shiftId, cashierId: req.user!.id, status: 'OPEN', ledgerVersion: 1 });
  if (!shift) throw ApiError.forbidden('Select your open ledger shift');
  const incoming = shift.accountOpenings?.find(account => account.id === input.accountId);
  const outgoing = shift.accountOpenings?.find(account => account.id === 'CASH_UGX');
  const rate = await ExchangeRate.findOne({ status: 'ACTIVE', baseCurrency: 'USD', targetCurrency: 'UGX' });
  if (!incoming || !outgoing || !rate) throw ApiError.badRequest('Select an opened account and configure an active exchange rate');
  const category = incoming.kind === 'WALLET' ? 'WALLET_USD_TO_CASH_UGX' : 'CASH_USD_TO_CASH_UGX';
  let quote;
  try { quote = quoteMovement(category, incoming, outgoing, input.amount, rate.rate); }
  catch (error) { throw ApiError.badRequest((error as Error).message); }
  return ApiResponse.success(res, 'Exchange quote', {
    category, exchangeRateId: String(rate._id), rate: rate.rate, feeUSD: quote.feeUSD, payoutUGX: quote.legs[1].amountMinor,
  });
}));
router.get('/shift/:id', asyncHandler(async (req: Request, res: Response) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw ApiError.badRequest('Invalid shift ID');
  const shift = await CashSession.findById(req.params.id);
  if (!shift) throw ApiError.notFound('Shift not found');
  if (req.user?.role === UserRole.CASHIER && String(shift.cashierId) !== req.user.id) throw ApiError.forbidden();
  if (shift.ledgerVersion !== 1) throw ApiError.badRequest('This shift predates movement capture; current balances are unverified');
  const operations = await FinancialOperation.find({ shiftId: shift._id }).sort({ occurredAt: 1, _id: 1 });
  const legs = operations.flatMap(operation => operation.legs as any);
  const eligibility = await ledgerClosingEligibility(shift);
  return ApiResponse.success(res, 'Recorded account movements', {
    operations,
    accounts: shift.accountOpenings?.map(account => ({ id: account.id, name: account.name, currency: account.currency, amount: account.amount,
      balance: accountBalanceMinor(account.amount, account, legs) / (account.currency === 'USD' ? 100 : 1) })),
    serviceFeesUSD: operations.reduce((sum, operation) => sum + Math.round(operation.feeUSD * 10000), 0) / 10000,
    serviceFeesUGX: operations.reduce((sum, operation) => sum + operation.feeUGX, 0),
    closingReady: eligibility.ready,
    closingBlockedReason: 'reason' in eligibility ? eligibility.reason : undefined,
  });
}));
export default router;
