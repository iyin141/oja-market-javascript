import { Controller, Get, HttpStatus, Injectable, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Money } from '@oja/shared';
import { Prisma_ } from '../infra/prisma';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { Problem } from '../common/http';

const kobo = (v: bigint | number | string) => Money.format(BigInt(v)).replace('₦', 'NGN '); // built-in PDF fonts have no naira glyph

type Line = { text: string; bold?: boolean; size?: number };

/**
 * Minimal text-only PDF writer (PDF 1.4, built-in Courier, so columns align by character count). No dependency:
 * an invoice only needs lines of text, and every extra package is more to patch. Wraps at `cols`, paginates at 52 lines.
 */
export function textPdf(lines: Line[], cols = 84, perPage = 52): Buffer {
  const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
  const wrapped: Line[] = lines.flatMap((l) => {
    if (l.text.length <= cols) return [l];
    const out: Line[] = [];
    for (let i = 0; i < l.text.length; i += cols) out.push({ ...l, text: l.text.slice(i, i + cols) });
    return out;
  });
  const pages: Line[][] = [];
  for (let i = 0; i < wrapped.length; i += perPage) pages.push(wrapped.slice(i, i + perPage));
  if (!pages.length) pages.push([]);

  const objs: string[] = []; // 1-based ids: 1 catalog, 2 pages, 3 Courier, 4 Courier-Bold, then page/content pairs
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>';
  const kids: number[] = [];
  pages.forEach((pg, n) => {
    const pageId = 5 + n * 2, contentId = pageId + 1;
    kids.push(pageId);
    let y = 800;
    const ops = pg.map((l) => { const size = l.size ?? 9; y -= size + 5; return `BT /${l.bold ? 'F2' : 'F1'} ${size} Tf 50 ${y} Td (${esc(l.text)}) Tj ET`; });
    ops.push(`BT /F1 7 Tf 50 30 Td (Page ${n + 1} of ${pages.length}) Tj ET`);
    const stream = ops.join('\n');
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objs[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) { offsets[i] = Buffer.byteLength(out); out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Left text and right-aligned amount on one fixed-width line. */
const row = (left: string, right: string, width = 84) => (left.length + right.length + 1 > width ? left.slice(0, width - right.length - 1) : left).padEnd(width - right.length) + right;

@Injectable()
export class InvoiceService {
  constructor(private db: Prisma_) {}

  /** PDF invoice for one order. Customer sees own orders; admin sees any. Totals come from the stored order, never recomputed. */
  async render(u: AuthUser, orderId: string): Promise<Buffer> {
    const o = await this.db.order.findFirst({
      where: { id: orderId, ...(u.role === 'ADMIN' ? {} : { userId: u.id }) },
      include: { user: { select: { name: true, email: true } }, subOrders: { include: { items: true, vendor: { select: { storeName: true } } } }, payments: true },
    });
    if (!o) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'order not found');

    const L: Line[] = [
      { text: 'OJA MARKET - TAX INVOICE', bold: true, size: 16 },
      { text: '' },
      { text: `Invoice no : INV-${o.id.slice(0, 8).toUpperCase()}` },
      { text: `Order      : ${o.id}` },
      { text: `Date       : ${o.createdAt.toISOString().slice(0, 10)}` },
      { text: `Payment    : ${o.paymentMethod}${o.payments[0] ? ` (${o.payments[0].status})` : ''}` },
      { text: '' },
      { text: 'Billed to', bold: true },
      { text: o.user.name }, { text: o.user.email },
    ];
    const a = o.address as any;
    if (a) L.push({ text: [a.line1, a.city, a.state].filter(Boolean).join(', ') }, { text: `Phone: ${a.phone ?? ''}` });

    let gross = 0n;
    for (const so of o.subOrders) {
      L.push({ text: '' }, { text: `Sold by ${so.vendor.storeName}`, bold: true });
      for (const it of so.items) {
        const line = it.unitPriceKobo * BigInt(it.qty); gross += line;
        L.push({ text: row(`${it.title}  x${it.qty} @ ${kobo(it.unitPriceKobo)}`, kobo(line)) });
      }
    }
    L.push({ text: '-'.repeat(84) }, { text: row('Subtotal', kobo(gross)) });
    if (o.discountKobo > 0n) L.push({ text: row(`Discount${o.couponCode ? ` (${o.couponCode})` : ''}`, `-${kobo(o.discountKobo)}`) });
    L.push({ text: row('TOTAL', kobo(o.totalKobo)), bold: true }, { text: '' },
      { text: 'Amounts are in Nigerian naira. Marketplace sale: each vendor is the seller of record for its items.', size: 7 });
    return textPdf(L);
  }
}

@Controller()
export class InvoiceController {
  constructor(private s: InvoiceService) {}
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Get('orders/:id/invoice')
  async invoice(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const pdf = await this.s.render(u, id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="invoice-${id.slice(0, 8)}.pdf"`, 'Content-Length': String(pdf.length) }).end(pdf);
  }
}
