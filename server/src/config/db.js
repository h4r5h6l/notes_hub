import mongoose from 'mongoose';

/**
 * Connect to MongoDB with a bounded timeout, so the API fails fast and
 * visibly instead of hanging forever when the database is unreachable.
 */
export async function connectDB(uri) {
  mongoose.connection.on('connected', () => {
    console.log('[db] connected to MongoDB');
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[db] disconnected from MongoDB');
  });

  mongoose.connection.on('error', (err) => {
    console.error('[db] connection error:', err.message);
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });
}

export async function disconnectDB() {
  await mongoose.disconnect();
  console.log('[db] connection closed');
}
