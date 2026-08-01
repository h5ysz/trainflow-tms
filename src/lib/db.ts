import { PrismaClient, Prisma } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Query logging is development-only: in production every statement (including
// audit metadata and registration payloads) would otherwise be written to disk
// on every request.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// Re-export Prisma namespace so callers can reference `Prisma.TransactionClient`
// without a second import from `@prisma/client`.
export { Prisma }