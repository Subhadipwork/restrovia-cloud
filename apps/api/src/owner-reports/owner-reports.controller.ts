import { ConflictException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { limit } from '../owner/owner-auth.controller.js';
import type { OwnerRow } from '../owner/owner-sessions.js';
import { CurrentOwner, OwnerGuard } from '../owner/owner.guard.js';
import { day } from '../owner-stores/owner-stores.controller.js';
import {
  CurrentStore,
  StoreMemberGuard,
  type StoreRow,
} from '../owner-stores/store-member.guard.js';
import { OwnerReportsService } from './owner-reports.service.js';
import { checksCsv, csvFileName, hoursCsv, itemsCsv, paymentsCsv, salesCsv } from './report-csv.js';

const range = { from: day.optional(), to: day.optional() };
const rangeQuery = z.object(range);
const salesQuery = z.object({ ...range, group: z.enum(['day', 'week', 'month']).default('day') });
const itemsQuery = z.object({
  ...range,
  sort: z.enum(['revenue', 'quantity']).default('revenue'),
  q: z.string().trim().min(1).max(64).optional(),
});

/** The file holds far more rows than the screen lists. */
const CHECKS_CSV_LIMIT = 5000;

function download(res: Response, fileName: string, body: string): string {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return body;
}

/** A café's reports (app.restrovia.in/api/owner/stores/:storeId/reports), as JSON or a CSV file. */
@Controller('api/owner/stores/:storeId/reports')
@UseGuards(OwnerGuard, StoreMemberGuard)
export class OwnerReportsController {
  constructor(private readonly reports: OwnerReportsService) {}

  @Get('sales')
  sales(
    @CurrentStore() store: StoreRow,
    @Query(new ZodPipe(salesQuery)) q: z.infer<typeof salesQuery>,
  ) {
    return this.reports.sales(store, q);
  }

  @Get('sales.csv')
  async salesFile(
    @CurrentStore() store: StoreRow,
    @Query(new ZodPipe(salesQuery)) q: z.infer<typeof salesQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.sales(store, q);
    return download(res, csvFileName(store, 'sales', report), salesCsv(store, report));
  }

  @Get('items')
  items(
    @CurrentStore() store: StoreRow,
    @Query(new ZodPipe(itemsQuery)) q: z.infer<typeof itemsQuery>,
  ) {
    return this.reports.items(store, q);
  }

  @Get('items.csv')
  async itemsFile(
    @CurrentStore() store: StoreRow,
    @Query(new ZodPipe(itemsQuery)) q: z.infer<typeof itemsQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.items(store, q);
    return download(res, csvFileName(store, 'items', report), itemsCsv(store, report));
  }

  @Get('hours')
  hours(
    @CurrentStore() store: StoreRow,
    @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>,
  ) {
    return this.reports.hours(store, q);
  }

  @Get('hours.csv')
  async hoursFile(
    @CurrentStore() store: StoreRow,
    @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.hours(store, q);
    return download(res, csvFileName(store, 'hours', report), hoursCsv(store, report));
  }

  @Get('checks')
  checks(
    @CurrentStore() store: StoreRow,
    @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>,
  ) {
    return this.reports.checks(store, q);
  }

  @Get('checks.csv')
  async checksFile(
    @CurrentStore() store: StoreRow,
    @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.checks(store, q, CHECKS_CSV_LIMIT);
    return download(res, csvFileName(store, 'checks', report), checksCsv(store, report));
  }

  @Get('payments')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(12), ttl: 60_000 } })
  payments(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>,
  ) {
    return this.reports.payments(store, owner.id, q);
  }

  @Get('payments.csv')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: limit(12), ttl: 60_000 } })
  async paymentsFile(
    @CurrentStore() store: StoreRow,
    @CurrentOwner() owner: OwnerRow,
    @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.payments(store, owner.id, q);
    if (!report.available) {
      throw new ConflictException({ error: 'payments_unavailable', reason: report.reason });
    }
    return download(res, csvFileName(store, 'payments', report), paymentsCsv(store, report));
  }
}
