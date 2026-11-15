import { env } from './env';

export const isExpandedLedgerEnabled = (): boolean =>
  env.NODE_ENV === 'development' || env.DEMO_MODE === 'true';

export const isDevResetEnabled = (): boolean =>
  env.NODE_ENV === 'development' && env.DEMO_MODE !== 'true' && env.ENABLE_DEV_RESET === 'true';
