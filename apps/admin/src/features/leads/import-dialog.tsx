'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/api-client';
import { type ImportResult, useImportLeads } from './api';

const TEMPLATE = [
  'business_name,contact_name,phone,alt_phone,email,city,area,address,business_type,outlet_count,current_pos,source,source_detail,temperature,expected_value,tags,owner_email',
  'Cafe Mocha,Riya Sen,98300 12345,,riya@example.com,Kolkata,Salt Lake,,cafe,2,Pen and paper,event,Food expo 2026,hot,1998,chain;mall,'
].join('\r\n');

const MAX_BYTES = 2_000_000;
const DUPLICATE_OF: Record<ImportResult['duplicates'][number]['of'], string> = {
  lead: 'an existing lead',
  store: 'a customer store',
  file: 'an earlier row in this file'
};

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'restrovia-leads-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const run = useImportLeads();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);

  const reset = () => {
    setCsv('');
    setFileName('');
    setPreview(null);
    setIncludeDuplicates(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const check = (text: string) =>
    run.mutate(
      { csv: text, dry_run: true, include_duplicates: false },
      { onSuccess: setPreview, onError: (err) => toast.error(errorMessage(err)) }
    );

  const willImport = preview
    ? preview.will_import + (includeDuplicates ? preview.duplicates.length : 0)
    : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>
            Up to 2,000 rows. Only <code>business_name</code> is required; 10-digit phone numbers
            get +91 added. Separate tags with a semicolon. Nothing is saved until you confirm.
          </DialogDescription>
        </DialogHeader>
        <Button variant='outline' size='sm' className='self-start' onClick={downloadTemplate}>
          Download template
        </Button>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='lead-csv'>CSV file</Label>
          <Input
            id='lead-csv'
            type='file'
            accept='.csv,text/csv'
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setPreview(null);
              if (!file) return;
              if (file.size > MAX_BYTES) {
                toast.error('That file is over 2 MB. Split it into smaller files.');
                return;
              }
              const text = await file.text();
              setCsv(text);
              setFileName(file.name);
              check(text);
            }}
          />
        </div>

        {run.isPending && !preview && <p className='text-sm'>Checking {fileName}…</p>}

        {preview && (
          <div className='flex flex-col gap-3 text-sm'>
            <div className='grid grid-cols-3 gap-2 text-center'>
              <div className='rounded-lg border p-2'>
                <div className='text-xl font-semibold tabular-nums'>{preview.total}</div>
                <div className='text-muted-foreground text-xs'>rows</div>
              </div>
              <div className='rounded-lg border p-2'>
                <div className='text-xl font-semibold tabular-nums'>{preview.will_import}</div>
                <div className='text-muted-foreground text-xs'>new leads</div>
              </div>
              <div className='rounded-lg border p-2'>
                <div className='text-xl font-semibold tabular-nums'>
                  {preview.invalid.length + preview.duplicates.length}
                </div>
                <div className='text-muted-foreground text-xs'>need a look</div>
              </div>
            </div>
            {preview.unknown_columns.length > 0 && (
              <p className='text-muted-foreground'>
                Ignored columns: {preview.unknown_columns.join(', ')}
              </p>
            )}
            {preview.invalid.length > 0 && (
              <div>
                <p className='font-medium'>Rows that will be skipped</p>
                <ul className='text-destructive mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto'>
                  {preview.invalid.map((r) => (
                    <li key={r.row}>
                      Row {r.row}: {r.issues.join('; ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.duplicates.length > 0 && (
              <div>
                <p className='font-medium'>Possible duplicates</p>
                <ul className='mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto'>
                  {preview.duplicates.map((d) => (
                    <li key={d.row}>
                      Row {d.row}: {d.business_name} looks like {DUPLICATE_OF[d.of]}
                    </li>
                  ))}
                </ul>
                <label htmlFor='import-duplicates' className='mt-2 flex items-center gap-2'>
                  <Checkbox
                    id='import-duplicates'
                    aria-label='Import the possible duplicates too'
                    checked={includeDuplicates}
                    onCheckedChange={(v) => setIncludeDuplicates(v === true)}
                  />
                  Import these too
                </label>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant='outline' onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!preview || willImport === 0 || run.isPending}
            onClick={() =>
              run.mutate(
                { csv, dry_run: false, include_duplicates: includeDuplicates },
                {
                  onSuccess: (r) => {
                    toast.success(`Imported ${r.imported} ${r.imported === 1 ? 'lead' : 'leads'}`);
                    close();
                  },
                  onError: (err) => toast.error(errorMessage(err))
                }
              )
            }
          >
            {run.isPending && preview
              ? 'Importing…'
              : `Import ${willImport} ${willImport === 1 ? 'lead' : 'leads'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
