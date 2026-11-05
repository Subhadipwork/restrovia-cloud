import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AdminRole } from '@restrovia/shared';
import { AdminAuthService, type AdminRow } from './admin-auth.service.js';

export const ADMIN_COOKIE = 'rv_admin';
/** Sent by the admin panel on every change; another site's page can't add it without CORS. */
export const ADMIN_CSRF_HEADER = 'x-restrovia-admin';

export type AdminRequest = Request & { admin?: AdminRow; adminSessionId?: string };

const ROLES_KEY = 'admin_roles';
/** Limits a route to these roles; routes without it are open to every signed-in admin. */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

export function readCookie(req: Request, name: string): string {
  for (const part of (req.header('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const found = await this.auth.sessionAdmin(readCookie(req, ADMIN_COOKIE));
    if (!found) throw new UnauthorizedException({ error: 'not_signed_in' });
    if (req.method !== 'GET' && req.header(ADMIN_CSRF_HEADER) !== '1') {
      throw new ForbiddenException({ error: 'missing_csrf_header' });
    }
    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && !roles.includes(found.admin.role as AdminRole)) {
      throw new ForbiddenException({ error: 'role_not_allowed' });
    }
    req.admin = found.admin;
    req.adminSessionId = found.sessionId;
    return true;
  }
}

export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminRow =>
    ctx.switchToHttp().getRequest<AdminRequest>().admin!,
);

/** For sign-in routes, which have no session yet: the panel header is still required. */
@Injectable()
export class AdminCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.header(ADMIN_CSRF_HEADER) !== '1') {
      throw new ForbiddenException({ error: 'missing_csrf_header' });
    }
    return true;
  }
}
