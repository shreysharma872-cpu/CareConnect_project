import { Pool, type PoolClient, type QueryResult } from 'pg'

export interface DbStatement {
  sql: string
  args?: unknown[]
}

export interface DbClient {
  execute(statement: string | DbStatement): Promise<QueryResult<Record<string, unknown>>>
  batch(statements: DbStatement[], mode?: 'read' | 'write'): Promise<void>
}

const runtime = globalThis as typeof globalThis & { __careConnectPostgresPool?: Pool }
const pool = runtime.__careConnectPostgresPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis: 20_000,
})
runtime.__careConnectPostgresPool = pool

function postgresSql(sql: string) {
  let anonymousIndex = 0
  return sql.replace(/\?(\d*)/g, (_match, index: string) => `$${index || ++anonymousIndex}`)
}

async function withClient<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try { return await callback(client) }
  finally { client.release() }
}

const db: DbClient = {
  async execute(statement) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    const query = typeof statement === 'string' ? { sql: statement, args: [] } : statement
    return pool.query(postgresSql(query.sql), query.args || [])
  },
  async batch(statements) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    await withClient(async client => {
      await client.query('BEGIN')
      try {
        for (const statement of statements) await client.query(postgresSql(statement.sql), statement.args || [])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    })
  },
}

export async function getDb(): Promise<DbClient> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  return db
}

export default getDb

export function toObj(row: Record<string, unknown> | undefined | null): Record<string, unknown> | null {
  return row ?? null
}

export function toObjs(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows
}
