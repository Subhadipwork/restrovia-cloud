import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
      });
    }
    return parsed.data;
  }
}
