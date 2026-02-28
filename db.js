import { MongoClient } from 'mongodb';

let client = null;
let usersCollection = null;
let statsCollection = null;
let historyCollection = null;
let anonymousUsageCollection = null;

export async function initDb() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is required');
  }
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();
  usersCollection = db.collection('users');
  statsCollection = db.collection('stats');
  historyCollection = db.collection('history');
  anonymousUsageCollection = db.collection('anonymous_usage');
  await usersCollection.createIndex({ email: 1 }, { unique: true });
  await statsCollection.updateOne(
    { _id: 'global' },
    { $setOnInsert: { tts: 0, stt: 0, translate: 0 } },
    { upsert: true }
  );
  await historyCollection.createIndex({ userId: 1, createdAt: -1 });
  await anonymousUsageCollection.createIndex({ anonymousId: 1 }, { unique: true });
  return { client, usersCollection, statsCollection, historyCollection, anonymousUsageCollection };
}

export function getUsersCollection() {
  if (!usersCollection) throw new Error('Database not initialized. Call initDb() first.');
  return usersCollection;
}

export function getStatsCollection() {
  if (!statsCollection) throw new Error('Database not initialized. Call initDb() first.');
  return statsCollection;
}

export function getHistoryCollection() {
  if (!historyCollection) throw new Error('Database not initialized. Call initDb() first.');
  return historyCollection;
}

export function getAnonymousUsageCollection() {
  if (!anonymousUsageCollection) throw new Error('Database not initialized. Call initDb() first.');
  return anonymousUsageCollection;
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    usersCollection = null;
    statsCollection = null;
    historyCollection = null;
    anonymousUsageCollection = null;
  }
}
