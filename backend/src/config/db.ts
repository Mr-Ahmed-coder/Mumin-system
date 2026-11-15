import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

export const connectDB = async (customUri?: string): Promise<void> => {
  try {
    const conn = await mongoose.connect(customUri || env.MONGO_URI);
    logger.info(
      {
        environment: env.NODE_ENV,
        host: conn.connection.host,
        database: conn.connection.name,
      },
      'MongoDB connected'
    );
  } catch (error) {
    logger.error({ err: error }, 'MongoDB connection error');
    process.exit(1);
  }
};
