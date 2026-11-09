import { PrismaClient, Prisma } from '@oja/db';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { config } from '../config';

@Injectable()
export class Prisma_ extends PrismaClient implements OnModuleDestroy {
  constructor() { super({ datasources: { db: { url: config.databaseUrl } } }); }
  async onModuleDestroy() { await this.$disconnect(); }
}
export type Tx = Prisma.TransactionClient;
export { Prisma };
