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
import type { AdminPermission } from '@restrovia/shared';
import { AdminAuthService, type AdminRow } from './admin-auth.service.js';

export const ADMIN_COOKIE = 'rv_admin';
/** Sent by the admin panel on every change; another site's page can't add it without CORS. */
export const ADMIN_CSRF_HEADER = 'x-restrovia-admin';

export type AdminRequest = Request & { admin?: AdminRow; adminSessionId?: string };

export const CAN_KEY = 'admin_permissions';
export const SIGNED_IN_KEY = 'admin_signed_in';
/** The route needs every one of these permissions. */
export const Can = (...permissions: [AdminPermission, ...AdminPermission[]]) =>
  SetMetadata(CAN_KEY, permissions);
/** The route is for any signed-in admin (their own account, sign-out). Every admin route must
 * carry either this or @Can; a test fails otherwise. */
export const SignedIn = () => SetMetadata(SIGNED_IN_KEY, true);

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
    const needed = this.reflector.getAllAndOverride<AdminPermission[] | undefined>(CAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (needed && !needed.every((p) => found.admin.permissions.has(p))) {
      throw new ForbiddenException({ error: 'permission_denied', needed });
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
