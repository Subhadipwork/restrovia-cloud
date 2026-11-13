import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import type { AdminRow } from '../admin/admin-auth.service.js';
import { AdminGuard, Can,
  CurrentAdmin, type AdminRequest } from '../admin/admin.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { LeadReportsService } from './lead-reports.service.js';
import {
  activitySchema,
  assignSchema,
  boardQuery,
  bulkSchema,
  createSchema,
  filterSchema,
  importSchema,
  linkSchema,
  listQuery,
  mergeSchema,
  pageSchema,
  reportsQuery,
  stageSchema,
  taskSchema,
  tasksQuery,
  taskUpdateSchema,
  updateSchema,
} from './lead-schemas.js';
import { LeadsService } from './leads.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const page = (q: { page: number; per_page: number }) => ({ page: q.page, perPage: q.per_page });

/** Sales pipeline in the admin panel. Support can read; sales and super admins can change. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly reports: LeadReportsService,
  ) {}

  @Get('leads/assignees')
  @Can('leads.view')
  assignees() {
    return this.leads.assignees();
  }

  @Get('leads/summary')
  @Can('leads.view')
  summary() {
    return this.reports.summary();
  }

  @Get('leads/board')
  @Can('leads.edit')
  board(
    @Query(new ZodPipe(boardQuery)) q: z.infer<typeof boardQuery>,
    @CurrentAdmin() admin: AdminRow,
  ) {
    return this.reports.board(q, admin);
  }

  @Get('leads/reports')
  @Can('leads.reports')
  report(@Query(new ZodPipe(reportsQuery)) q: z.infer<typeof reportsQuery>) {
    return this.reports.reports(q.from, q.to);
  }

  @Get('leads/export.csv')
  @Can('leads.export')
  async export(
    @Query(new ZodPipe(filterSchema)) q: z.infer<typeof filterSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    const csv = await this.leads.exportCsv(q, admin, req.ip ?? null);
    const day = new Date().toISOString().slice(0, 10);
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="restrovia-leads-${day}.csv"`,
        'Cache-Control': 'no-store',
      })
      .send(`\uFEFF${csv}`);
  }

  @Post('leads/import')
  @HttpCode(200)
  @Can('leads.edit')
  import(
    @Body(new ZodPipe(importSchema)) body: z.infer<typeof importSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.leads.importCsv(body, admin, req.ip ?? null);
  }

  @Post('leads/bulk')
  @HttpCode(200)
  @Can('leads.edit')
  bulk(
    @Body(new ZodPipe(bulkSchema)) body: z.infer<typeof bulkSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.leads.bulk(body, admin, req.ip ?? null);
  }

  @Get('leads')
  @Can('leads.view')
  list(
    @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>,
    @CurrentAdmin() admin: AdminRow,
  ) {
    const { page: p, per_page, ...filters } = q;
    return this.leads.list(filters, page({ page: p, per_page }), admin);
  }

  @Post('leads')
  @Can('leads.edit')
  create(
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.leads.create(body, admin, req.ip ?? null);
  }

  @Get('leads/:id')
  @Can('leads.view')
  detail(@Param('id', uuid) id: string) {
    return this.leads.detail(id);
  }

  @Patch('leads/:id')
  @Can('leads.edit')
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.leads.update(id, body, admin, req.ip ?? null);
  }

  @Delete('leads/:id')
  @Can('leads.delete')
  remove(@Param('id', uuid) id: string, @CurrentAdmin() admin: AdminRow, @Req() req: AdminRequest) {
    return this.leads.remove(id, admin, req.ip ?? null);
  }

  @Post('leads/:id/stage')
  @Can('leads.edit')
  stage(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(stageSchema)) body: z.infer<typeof stageSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.leads.changeStage(id, body, admin, req.ip ?? null);
  }

  @Post('leads/:id/assign')
  @Can('leads.edit')
  assign(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(assignSchema)) body: z.infer<typeof assignSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.leads.assign(id, body.admin_id, admin, req.ip ?? null);
  }

  @Post('leads/:id/store')
  @Can('leads.edit')
  linkStore(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(linkSchema)) body: z.infer<typeof linkSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.leads.linkStore(id, body.store_id, admin, req.ip ?? null);
  }

  @Post('leads/:id/merge')
  @HttpCode(200)
  @Can('leads.edit')
  merge(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(mergeSchema)) body: z.infer<typeof mergeSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.leads.merge(id, body.duplicate_id, admin, req.ip ?? null);
  }

  @Get('leads/:id/activities')
  @Can('leads.view')
  activities(
    @Param('id', uuid) id: string,
    @Query(new ZodPipe(pageSchema)) q: z.infer<typeof pageSchema>,
  ) {
    return this.leads.activities(id, page(q));
  }

  @Post('leads/:id/activities')
  @Can('leads.edit')
  addActivity(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(activitySchema)) body: z.infer<typeof activitySchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.leads.addActivity(id, body, admin, req.ip ?? null);
  }

  @Post('leads/:id/tasks')
  @Can('leads.edit')
  addTask(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(taskSchema)) body: z.infer<typeof taskSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.leads.addTask(id, body, admin, req.ip ?? null);
  }

  @Get('lead-tasks')
  @Can('leads.edit')
  tasks(
    @Query(new ZodPipe(tasksQuery)) q: z.infer<typeof tasksQuery>,
    @CurrentAdmin() admin: AdminRow,
  ) {
    return this.leads.listTasks(q, admin);
  }

  @Patch('lead-tasks/:id')
  @Can('leads.edit')
  updateTask(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(taskUpdateSchema)) body: z.infer<typeof taskUpdateSchema>,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.leads.updateTask(id, body, admin, req.ip ?? null);
  }

  @Delete('lead-tasks/:id')
  @Can('leads.edit')
  removeTask(
    @Param('id', uuid) id: string,
    @CurrentAdmin() admin: AdminRow,
    @Req() req: AdminRequest,
  ) {
    return this.leads.removeTask(id, admin, req.ip ?? null);
  }
}
