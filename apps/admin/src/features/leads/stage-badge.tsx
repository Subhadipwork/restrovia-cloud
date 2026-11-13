import type { LeadStage } from '@restrovia/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STAGE_COLOURS, STAGE_LABELS } from './labels';

export function StageBadge({ stage, className }: { stage: LeadStage; className?: string }) {
  return (
    <Badge variant='outline' className={cn(STAGE_COLOURS[stage].soft, className)}>
      {STAGE_LABELS[stage]}
    </Badge>
  );
}
