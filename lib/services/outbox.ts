import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db/prisma';
import { EmailOutboxKind } from '../constants';

export interface SendSimulatedEmailInput {
  toAddress: string;
  subject: string;
  body: string;
  kind: EmailOutboxKind;
}

export async function queueSimulatedEmail(
  input: SendSimulatedEmailInput,
  tx?: Prisma.TransactionClient | PrismaClient
): Promise<{ id: string }> {
  const client = tx || prisma;
  return client.emailOutbox.create({
    data: {
      toAddress: input.toAddress,
      subject: input.subject,
      body: input.body,
      kind: input.kind,
    },
    select: { id: true },
  });
}
