import 'dotenv/config';
import { MongoClient } from 'mongodb';

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set. Add it to the local environment or Render before running this check.');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI, { appName: 'saharsa-news-connectivity-check', serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  await client.db(process.env.MONGODB_DB || 'saharsa_news').command({ ping: 1 });
  console.log('MongoDB connection and ping succeeded.');
} catch (error) {
  console.error('MongoDB connection or ping failed.', error?.name || 'MongoError', error?.code || '');
  process.exitCode = 1;
} finally {
  await client.close();
}
