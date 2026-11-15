import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import { logger } from '../config/logger';
import { UserRole } from '../constants/roles';
import { User } from '../models/User';
import { ExchangeRate } from '../models/ExchangeRate';

export const seedDemo = async (customUri?: string) => {
  await connectDB(customUri || process.env.DEMO_MONGO_URI);

  const dbName = mongoose.connection.name;
  logger.info({ database: dbName }, 'Connected to database for demo seeding');

  // Hard safety check: refuse to seed if connected to 'cash' or production without explicit override
  if (dbName === 'cash') {
    throw new Error(
      'SAFETY ABORT: Current database is "cash". Demo seeding must target a dedicated demo database (e.g., "mumin_demo").'
    );
  }

  // 1. Seed or update Demo Admin (Owner)
  const ownerEmail = 'owner@mumin-demo.com';
  const ownerPassword = process.env.DEMO_OWNER_PASSWORD || 'DemoOwner2026!';
  let owner = await User.findOne({ email: ownerEmail }).select('+password');
  if (!owner) {
    owner = await User.create({
      name: 'Shop Owner (Demo)',
      email: ownerEmail,
      phone: '+256700000001',
      password: ownerPassword,
      role: UserRole.ADMIN,
      status: 'ACTIVE',
    });
    logger.info({ email: ownerEmail }, 'Created Demo Owner account');
  } else {
    owner.name = 'Shop Owner (Demo)';
    owner.role = UserRole.ADMIN;
    owner.status = 'ACTIVE';
    owner.password = ownerPassword;
    await owner.save();
    logger.info({ email: ownerEmail }, 'Synchronized Demo Owner account');
  }

  // 2. Seed or update Demo Cashier
  const cashierEmail = 'cashier@mumin-demo.com';
  const cashierPassword = process.env.DEMO_CASHIER_PASSWORD || 'DemoCashier2026!';
  let cashier = await User.findOne({ email: cashierEmail }).select('+password');
  if (!cashier) {
    cashier = await User.create({
      name: 'Demo Cashier',
      email: cashierEmail,
      phone: '+256700000002',
      password: cashierPassword,
      role: UserRole.CASHIER,
      status: 'ACTIVE',
    });
    logger.info({ email: cashierEmail }, 'Created Demo Cashier account');
  } else {
    cashier.name = 'Demo Cashier';
    cashier.role = UserRole.CASHIER;
    cashier.status = 'ACTIVE';
    cashier.password = cashierPassword;
    await cashier.save();
    logger.info({ email: cashierEmail }, 'Synchronized Demo Cashier account');
  }

  // 3. Ensure active Exchange Rate exists
  let activeRate = await ExchangeRate.findOne({ status: 'ACTIVE', baseCurrency: 'USD', targetCurrency: 'UGX' });
  if (!activeRate) {
    activeRate = await ExchangeRate.create({
      rate: 3800,
      baseCurrency: 'USD',
      targetCurrency: 'UGX',
      status: 'ACTIVE',
    });
    logger.info({ rate: activeRate.rate }, 'Created default active USD/UGX exchange rate (3800)');
  } else {
    logger.info({ rate: activeRate.rate }, 'Active exchange rate already present');
  }

  logger.info({ database: dbName }, 'Demo seed completed successfully');
};

if (require.main === module) {
  seedDemo()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error({ err: error }, 'Demo seeding failed');
      await mongoose.disconnect().catch(() => undefined);
      process.exit(1);
    });
}
