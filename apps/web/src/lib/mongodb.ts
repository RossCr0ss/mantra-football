import { MongoClient } from 'mongodb';

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

const options = {
  maxPoolSize: 10,       // cap simultaneous connections per process
  minPoolSize: 1,
  maxIdleTimeMS: 30_000, // close idle connections after 30 s
};

// Lazy singleton: nothing happens at import time, so `next build` ("Collect page data"
// imports every route module) works without MONGODB_URI. The connection and the env check
// happen on the first getDb() call. In development the promise is stashed on `global` so
// HMR reloads don't spawn extra clients.
let clientPromise: Promise<MongoClient> | undefined;

function getClient(): Promise<MongoClient> {
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev && global._mongoClientPromise) return global._mongoClientPromise;
  if (clientPromise) return clientPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) return Promise.reject(new Error('Please set the MONGODB_URI environment variable'));

  clientPromise = new MongoClient(uri, options).connect();
  // Don't cache a failed connection — let the next call retry.
  clientPromise.catch(() => {
    clientPromise = undefined;
    if (isDev) global._mongoClientPromise = undefined;
  });
  if (isDev) global._mongoClientPromise = clientPromise;
  return clientPromise;
}

export function getDb() {
  return getClient().then((c) => c.db('mantra-football'));
}
