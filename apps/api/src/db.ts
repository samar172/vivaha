import { PrismaClient, Prisma } from "@prisma/client";

export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Prisma.TransactionClient;
export const D = (n: Prisma.Decimal | number | string | null | undefined) => Number(n ?? 0);
