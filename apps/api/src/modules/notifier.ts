import { Inject, Injectable } from '@nestjs/common';
import { Prisma_ } from '../infra/prisma';
import { Mailer } from '../infra/jobs';
import { MAILER } from '../tokens';

const SUBJECTS: Record<string, string> = {
  'order.new': 'New order received', 'order.paid': 'Payment received', 'order.shipped': 'Your order has shipped',
  'vendor.approved': 'Your store is approved', 'vendor.rejected': 'Your application needs changes', 'vendor.suspended': 'Your store was suspended',
  'return.requested': 'A customer requested a return', 'return.refunded': 'Your refund was issued',
};

/** In-app notification row + email. Runs in the worker. */
@Injectable()
export class Notifier {
  constructor(private db: Prisma_, @Inject(MAILER) private mailer: Mailer) {}
  async send(userId: string, type: string, payload: Record<string, unknown>) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) return;
    await this.db.notification.create({ data: { userId, type, payload: JSON.parse(JSON.stringify(payload)) } });
    await this.mailer.send(user.email, `[Oja Market] ${SUBJECTS[type] ?? type}`, `Hi ${user.name},\n\n${SUBJECTS[type] ?? type}.\n\n${JSON.stringify(payload, null, 2)}\n`);
  }
}
