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
import { readCookie } from '../admin/admin.guard.js';
import { OwnerAuthService } from './owner-auth.service.js';
import type { OwnerRow, RequestContext } from './owner-sessions.js';

export const OWNER_COOKIE = 'rv_owner';
/** Sent by the owner portal on every change; another site's page can't add it without CORS. */
export const OWNER_CSRF_HEADER = 'x-restrovia-owner';

export type OwnerRequest = Request & { owner?: OwnerRow; ownerSessionId?: string };

export const requestContext = (req: Request): RequestContext => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
});

const ALLOWED_BEFORE_OWN_PASSWORD = 'owner_allowed_before_own_password';
/**
 * Marks the routes an owner can use while still on a password a Restrovia admin set: reading the
 * profile, choosing their own password and signing out. Everything else waits.
 */
export const AllowedBeforeOwnPassword = () => SetMetadata(ALLOWED_BEFORE_OWN_PASSWORD, true);

@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(
    private readonly auth: OwnerAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OwnerRequest>();
    const found = await this.auth.sessionOwner(readCookie(req, OWNER_COOKIE));
    if (!found) throw new UnauthorizedException({ error: 'not_signed_in' });
    if (req.method !== 'GET' && req.header(OWNER_CSRF_HEADER) !== '1') {
      throw new ForbiddenException({ error: 'missing_csrf_header' });
    }
    if (
      found.owner.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOWED_BEFORE_OWN_PASSWORD, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      throw new ForbiddenException({ error: 'password_change_required' });
    }
    req.owner = found.owner;
    req.ownerSessionId = found.sessionId;
    return true;
  }
}

/** For routes used before signing in: the portal header is still required. */
@Injectable()
export class OwnerCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.header(OWNER_CSRF_HEADER) !== '1') {
      throw new ForbiddenException({ error: 'missing_csrf_header' });
    }
    return true;
  }
}

export const CurrentOwner = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): OwnerRow =>
    ctx.switchToHttp().getRequest<OwnerRequest>().owner!,
);
