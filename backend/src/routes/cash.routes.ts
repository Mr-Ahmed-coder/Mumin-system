import { Router } from 'express';
import { env } from '../config/env';
import { isExpandedLedgerEnabled } from '../config/features';
import {
  getCurrentCashSession,
  getOpeningAccounts,
  openExpandedCashSession,
  getCashSessionById,
  openCashSession,
  addCashToSession,
  withdrawCashFromSession,
  closeCashSession,
  reopenCashSession,
  getCashSessionsList,
  getLedgerClose,
  confirmLedgerClose,
} from '../controllers/cash.controller';
import { authenticate, authorize } from '../middlewares/auth';
import { UserRole } from '../constants/roles';
import { validateRequest } from '../middlewares/validateRequest';
import {
  openCashSessionSchema,
  adjustCashSchema,
  closeCashSessionSchema,
} from '../dtos/cash.dto';

const router = Router();

router.use(authenticate);
router.get('/opening-mode', authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER), (_req, res) => {
  res.json({ success: true, data: { expanded: isExpandedLedgerEnabled() } });
});
if (isExpandedLedgerEnabled()) {
  router.get('/opening-accounts', authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER), getOpeningAccounts);
  router.post('/open-accounts', authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER), openExpandedCashSession);
  router.get('/:id/ledger-close', authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER), getLedgerClose);
  router.post('/:id/ledger-close', authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER), confirmLedgerClose);
}

router.get('/current', getCurrentCashSession);
router.get('/:id', getCashSessionById);
router.post('/open', validateRequest(openCashSessionSchema), openCashSession);
router.post('/add-cash', validateRequest(adjustCashSchema), addCashToSession);
router.post('/withdraw-cash', validateRequest(adjustCashSchema), withdrawCashFromSession);
router.post('/close', validateRequest(closeCashSessionSchema), closeCashSession);
router.post('/:id/reopen', authorize(UserRole.ADMIN, UserRole.MANAGER), reopenCashSession);
router.get('/', authorize(UserRole.ADMIN, UserRole.MANAGER), getCashSessionsList);

export default router;
