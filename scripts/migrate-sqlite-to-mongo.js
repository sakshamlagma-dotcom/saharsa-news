import 'dotenv/config';
import { createRequire } from 'node:module';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { ensureIndexes } from '../server.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const sourcePath = (() => {
  const position = process.argv.indexOf('--source');
  return path.resolve(position >= 0 ? process.argv[position + 1] : 'data/saharsa.sqlite');
})();
const apply = process.argv.includes('--apply');
const tables = [
  ['users', 'render_users', 'id'],
  ['articles', 'render_articles', 'id'],
  ['news_sources', 'render_news_sources', 'id'],
  ['audit_logs', 'render_audit_logs', 'id'],
  ['sessions', 'render_sessions', 'sid']
];

if (!process.env.MONGODB_URI && apply) throw new Error('Set MONGODB_URI in the local environment before applying the import.');
const sqlite = new Database(sourcePath, { readonly: true, fileMustExist: true });
const source = new Map(tables.map(([table]) => [table, sqlite.prepare(`SELECT * FROM ${table}`).all()]));
sqlite.close();
console.log(`SQLite source opened read-only: ${sourcePath}`);
for (const [table] of tables) console.log(`${table}: ${source.get(table).length} row(s)`);
if (!apply) {
  console.log('Dry run only. To copy without overwriting existing MongoDB documents, rerun with --apply and MONGODB_URI set.');
  process.exit(0);
}

const client = new MongoClient(process.env.MONGODB_URI, { appName: 'saharsa-news-sqlite-import', serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'saharsa_news');
  await ensureIndexes(db);
  for (const [table, collectionName, key] of tables) {
    const rows = source.get(table).map(row => {
      if (table === 'sessions') {
        let session;
        try { session = JSON.parse(row.session); } catch { return null; }
        return { _id: row.sid, session, expiresAt: new Date(row.expires) };
      }
      return { ...row, _id: row[key] };
    }).filter(Boolean);
    if (!rows.length) continue;
    const collection = db.collection(collectionName);
    const result = await collection.bulkWrite(rows.map(document => ({ updateOne: { filter: { _id: document._id }, update: { $setOnInsert: document }, upsert: true } })), { ordered: false });
    console.log(`${table}: ${result.upsertedCount} inserted; existing records left unchanged`);
  }
  console.log('Import finished. The SQLite source file was not modified or deleted.');
} catch (error) {
  console.error('Import failed. The SQLite source remains unchanged.', error?.name || 'MongoError', error?.code || '');
  process.exitCode = 1;
} finally {
  await client.close();
}
