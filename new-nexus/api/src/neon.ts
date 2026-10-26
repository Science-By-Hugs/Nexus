import { neon } from '@neondatabase/serverless';
import { mapDbError, type Db } from './db';

// Neon's serverless driver sends each query over HTTPS, which suits Workers:
// no connection to hold open, and the database can sleep between requests.
export function neonDb(connectionString: string): Db {
  const sql = neon(connectionString);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      try {
        return (await sql.query(text, params)) as T[];
      } catch (err) {
        throw mapDbError(err);
      }
    },
  };
}
