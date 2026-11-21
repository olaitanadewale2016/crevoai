import dns from 'dns';
import mongoose from 'mongoose';

// Ensure SRV DNS records (mongodb+srv://) resolve properly across Windows and various networks
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore in non-configurable environments
}

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var __crevoMongoose: MongooseCache | undefined;
}

const cached: MongooseCache = global.__crevoMongoose ?? { conn: null, promise: null };
global.__crevoMongoose = cached;

export function getMongoUri(): string {
  if (!process.env.MONGODB_URI) {
    try {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === 'function') {
        (process as any).loadEnvFile(envPath);
      }
    } catch {}
  }
  return process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/crevo';
}

export async function connectDB(): Promise<typeof mongoose> {
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (!cached.promise) {
    const uri = getMongoUri();
    cached.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 15000,
      })
      .then((m) => m)
      .catch((err) => {
        cached.promise = null;
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

export async function pingDB(customUri?: string): Promise<{ ok: boolean; error?: string }> {
  if (customUri) {
    const conn = mongoose.createConnection(customUri, { serverSelectionTimeoutMS: 5000 });
    try {
      await conn.asPromise();
      await conn.db?.admin().ping();
      await conn.close();
      return { ok: true };
    } catch (e: any) {
      try {
        await conn.close();
      } catch {
        // ignore
      }
      return { ok: false, error: e?.message || 'MongoDB connection failed' };
    }
  }
  try {
    const m = await connectDB();
    await m.connection.db?.admin().ping();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'MongoDB connection failed' };
  }
}

export function isValidObjectId(id: unknown): id is string {
  return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && new mongoose.Types.ObjectId(id).toString() === id;
}

export function toObjectId(id: string | mongoose.Types.ObjectId): mongoose.Types.ObjectId {
  return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
}
