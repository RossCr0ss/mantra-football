import { MongoClient } from 'mongodb';

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Please set the MONGODB_URI environment variable');

const options = {
  maxPoolSize: 10,       // cap simultaneous connections per process
  minPoolSize: 1,
  maxIdleTimeMS: 30_000, // close idle connections after 30 s
};

// Module-level singleton — created once per process in both envs.
// In development we stash it on `global` so HMR reloads don't spawn extra clients.
let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === 'development') {
  if (!global._mongoClientPromise) {
    global._mongoClientPromise = new MongoClient(uri, options).connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  clientPromise = new MongoClient(uri, options).connect();
}

export function getDb() {
  return clientPromise.then((c) => c.db('mantra-football'));
}
