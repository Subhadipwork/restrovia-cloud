import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import type { OwnerRow } from '../owner/owner-sessions.js';
import { CurrentOwner, OwnerGuard } from '../owner/owner.guard.js';
import { day } from '../owner-stores/owner-stores.controller.js';
import { OwnerReportsService } from './owner-reports.service.js';
import { outletsCsv, outletsCsvFileName } from './report-csv.js';

const rangeQuery = z.object({ from: day.optional(), to: day.optional() });

/** Every café the person is linked to, side by side (app.restrovia.in/api/owner/outlets). */
@Controller('api/owner')
@UseGuards(OwnerGuard)
export class OwnerOutletsController {
  constructor(private readonly reports: OwnerReportsService) {}

  @Get('outlets')
  outlets(
    @CurrentOwner() owner: OwnerRow,
    @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>,
  ) {
    return this.reports.outlets(owner.id, q);
  }

  @Get('outlets.csv')
  async outletsFile(
    @CurrentOwner() owner: OwnerRow,
    @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.outlets(owner.id, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${outletsCsvFileName(report)}"`);
    return outletsCsv(report);
  }
}
