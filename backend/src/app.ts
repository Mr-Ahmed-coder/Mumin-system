import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { isDevResetEnabled, isExpandedLedgerEnabled } from './config/features';
import { errorHandler } from './middlewares/errorHandler';

import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import customerRoutes from './routes/customer.routes';
import feeRoutes from './routes/fee.routes';
import cashRoutes from './routes/cash.routes';
import transactionRoutes from './routes/transaction.routes';
import dashboardRoutes from './routes/dashboard.routes';
import reportRoutes from './routes/report.routes';
import auditRoutes from './routes/audit.routes';
import expenseRoutes from './routes/expense.routes';
import exchangeRateRoutes from './routes/exchangeRate.routes';
import internetCreditRoutes from './routes/internetCredit.routes';
import customerDepositRoutes from './routes/customerDeposit.routes';

const app: Application = express();

// Render terminates HTTPS at its proxy. Trust the first proxy so Express sees
// the original protocol and client address correctly.
app.set('trust proxy', 1);

// Security Middlewares
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
  })
);

// Rate Limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // limit each IP to 300 requests per windowMs
  message: { success: false, message: 'Too many requests from this IP, please try again later.' },
});
app.use('/api', limiter);

// Request Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// API Routes
const API_PREFIX = '/api/v1';

// Friendly root response for hosting platforms and direct browser visits.
app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Mumin Agent API is running',
    health: `${API_PREFIX}/health`,
  });
});

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/users`, userRoutes);
app.use(`${API_PREFIX}/customers`, customerRoutes);
app.use(`${API_PREFIX}/fee-rules`, feeRoutes);
app.use(`${API_PREFIX}/cash-sessions`, cashRoutes);
app.use(`${API_PREFIX}/transactions`, transactionRoutes);
app.use(`${API_PREFIX}/dashboard`, dashboardRoutes);
app.use(`${API_PREFIX}/reports`, reportRoutes);
app.use(`${API_PREFIX}/audit-logs`, auditRoutes);
app.use(`${API_PREFIX}/expenses`, expenseRoutes);
app.use(`${API_PREFIX}/exchange-rates`, exchangeRateRoutes);
app.use(`${API_PREFIX}/internet-credits`, internetCreditRoutes);
app.use(`${API_PREFIX}/customer-deposits`, customerDepositRoutes);

// Development reset tools are disabled on demo or production environments.
if (isDevResetEnabled()) {
  const developmentRoutes = require('./routes/development.routes').default;
  app.use(`${API_PREFIX}/development`, developmentRoutes);
}

// Expanded account operations are enabled in development or when DEMO_MODE=true.
if (isExpandedLedgerEnabled()) {
  app.use(`${API_PREFIX}/account-operations`, require('./routes/accountOperations.routes').default);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, status: 'ok' });
});

app.get(`${API_PREFIX}/health`, (_req, res) => {
  res.status(200).json({ success: true, status: 'ok' });
});

// Centralized Error Handling Middleware
app.use(errorHandler);

export default app;
