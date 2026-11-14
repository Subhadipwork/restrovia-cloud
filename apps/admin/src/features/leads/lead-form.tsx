'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  LEAD_BUSINESS_TYPES,
  LEAD_SOURCES,
  LEAD_TEMPERATURES,
  type LeadBusinessType,
  type LeadSource,
  type LeadTemperature
} from '@restrovia/shared';
import { Button } from '@/components/ui/button';
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { usePlans } from '@/features/admin/api';
import { useCan } from '@/features/auth/use-admin';
import { ApiError, errorMessage } from '@/lib/api-client';
import {
  type DuplicateMatches,
  type Lead,
  type LeadInput,
  type LeadPhoto,
  syncLeadPhotos,
  useAssignees,
  useCreateLead,
  useUpdateLead
} from './api';
import { BUSINESS_TYPE_LABELS, normalisePhone, SOURCE_LABELS, TEMPERATURE_LABELS } from './labels';
import { type LatLng, LocationPicker, type Place } from './location-picker';
import { type NewPhoto, PhotoPicker } from './photo-picker';
import { StageBadge } from './stage-badge';

type FormState = {
  business_name: string;
  contact_name: string;
  phone: string;
  alt_phone: string;
  email: string;
  city: string;
  area: string;
  address: string;
  location: LatLng | null;
  business_type: LeadBusinessType | '';
  outlet_count: string;
  current_pos: string;
  source: LeadSource;
  source_detail: string;
  temperature: LeadTemperature;
  interested_plan_id: string;
  expected_value: string;
  expected_close_on: string;
  tags: string;
  assigned_admin_id: string;
};

function initialState(lead?: Lead): FormState {
  return {
    business_name: lead?.businessName ?? '',
    contact_name: lead?.contactName ?? '',
    phone: lead?.phoneE164 ?? '',
    alt_phone: lead?.altPhoneE164 ?? '',
    email: lead?.email ?? '',
    city: lead?.city ?? '',
    area: lead?.area ?? '',
    address: lead?.address ?? '',
    location:
      lead?.latitude && lead.longitude
        ? { lat: Number(lead.latitude), lng: Number(lead.longitude) }
        : null,
    business_type: lead?.businessType ?? '',
    outlet_count: String(lead?.outletCount ?? 1),
    current_pos: lead?.currentPos ?? '',
    source: lead?.source ?? 'cold_call',
    source_detail: lead?.sourceDetail ?? '',
    temperature: lead?.temperature ?? 'warm',
    interested_plan_id: lead?.interestedPlanId ?? '',
    expected_value: lead?.expectedValue ?? '',
    expected_close_on: lead?.expectedCloseOn ?? '',
    tags: lead?.tags.join(', ') ?? '',
    assigned_admin_id: lead?.assignedAdminId ?? ''
  };
}

const blank = (v: string) => v.trim() || null;

function toInput(f: FormState): LeadInput {
  return {
    business_name: f.business_name.trim(),
    contact_name: blank(f.contact_name),
    phone: blank(normalisePhone(f.phone)),
    alt_phone: blank(normalisePhone(f.alt_phone)),
    email: blank(f.email),
    city: blank(f.city),
    area: blank(f.area),
    address: blank(f.address),
    location: f.location,
    business_type: f.business_type || null,
    outlet_count: Math.max(1, Number(f.outlet_count) || 1),
    current_pos: blank(f.current_pos),
    source: f.source,
    source_detail: blank(f.source_detail),
    temperature: f.temperature,
    interested_plan_id: f.interested_plan_id || null,
    expected_value: blank(f.expected_value),
    expected_close_on: f.expected_close_on || null,
    tags: f.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  };
}

function Field({
  id,
  label,
  children,
  wide
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-2 ${wide ? 'sm:col-span-2' : ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function DuplicateWarning({ matches }: { matches: DuplicateMatches }) {
  return (
    <div className='rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm' role='alert'>
      <p className='font-medium'>This looks like a business you already have.</p>
      <ul className='mt-2 flex flex-col gap-1'>
        {matches.leads.map((l) => (
          <li key={l.id}>
            Lead:{' '}
            <Link href={`/dashboard/leads/${l.id}`} className='font-medium underline'>
              {l.business_name}
            </Link>
            {l.city && ` · ${l.city}`}
            {l.phone && ` · ${l.phone}`} <StageBadge stage={l.stage} />
          </li>
        ))}
        {matches.stores.map((s) => (
          <li key={s.id}>
            Customer store:{' '}
            <Link href={`/dashboard/stores/${s.id}`} className='font-medium underline'>
              {s.name || 'Unnamed store'}
            </Link>
            {s.phone && ` · ${s.phone}`}
          </li>
        ))}
      </ul>
      <p className='text-muted-foreground mt-2'>
        Open the existing record, or choose “Add anyway” if this really is a different business.
      </p>
    </div>
  );
}

/** Add a lead, or edit one when `lead` is given. */
export function LeadFormDialog({
  open,
  onClose,
  lead,
  photos = []
}: {
  open: boolean;
  onClose: () => void;
  lead?: Lead;
  photos?: LeadPhoto[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [addedPhotos, setAddedPhotos] = useState<NewPhoto[]>([]);
  const [removedPhotos, setRemovedPhotos] = useState<string[]>([]);
  const [savingPhotos, setSavingPhotos] = useState(false);
  const create = useCreateLead();
  const update = useUpdateLead(lead?.id ?? '');
  const seesPlans = useCan('plans.view');
  const plans = usePlans(false, seesPlans);
  const assignees = useAssignees();
  const [form, setForm] = useState(() => initialState(lead));
  const [duplicates, setDuplicates] = useState<DuplicateMatches | null>(null);
  const pending = create.isPending || update.isPending || savingPhotos;

  const applyPlace = (place: Place, overwrite: boolean) =>
    setForm((f) => ({
      ...f,
      address: overwrite || !f.address.trim() ? place.address.slice(0, 500) : f.address,
      area: (overwrite || !f.area.trim()) && place.area ? place.area.slice(0, 100) : f.area,
      city: (overwrite || !f.city.trim()) && place.city ? place.city.slice(0, 100) : f.city
    }));

  /** Uploads the photo changes once the lead exists; the lead itself is already saved. */
  const savePhotos = async (leadId: string) => {
    if (!addedPhotos.length && !removedPhotos.length) return;
    setSavingPhotos(true);
    const failed = await syncLeadPhotos(
      leadId,
      addedPhotos.map((p) => p.blob),
      removedPhotos
    );
    setSavingPhotos(false);
    void queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
    if (failed)
      toast.error(`${failed} photo change${failed === 1 ? '' : 's'} didn’t save. Try again.`);
  };

  const set =
    (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      if (['business_name', 'phone', 'alt_phone', 'email', 'city'].includes(k)) {
        setDuplicates(null);
      }
    };

  const close = () => {
    setDuplicates(null);
    addedPhotos.forEach((p) => URL.revokeObjectURL(p.url));
    setAddedPhotos([]);
    setRemovedPhotos([]);
    if (!lead) setForm(initialState());
    onClose();
  };

  const submit = (force: boolean) => {
    const input = toInput(form);
    if (lead) {
      update.mutate(input, {
        onSuccess: async () => {
          await savePhotos(lead.id);
          toast.success('Lead saved');
          close();
        },
        onError: (err) => toast.error(errorMessage(err))
      });
      return;
    }
    create.mutate(
      { ...input, assigned_admin_id: form.assigned_admin_id || null, force },
      {
        onSuccess: async ({ id }) => {
          await savePhotos(id);
          toast.success(`${input.business_name} added`);
          close();
          router.push(`/dashboard/leads/${id}`);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.body.error === 'possible_duplicates') {
            setDuplicates((err.body as unknown as { matches: DuplicateMatches }).matches);
            return;
          }
          toast.error(errorMessage(err));
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{lead ? 'Edit lead' : 'Add a lead'}</DialogTitle>
            <DialogDescription>
              One lead per business. A chain with several outlets is one lead with an outlet count.
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-4 sm:grid-cols-2'>
            <Field id='business_name' label='Business name' wide>
              <Input
                id='business_name'
                required
                maxLength={200}
                value={form.business_name}
                onChange={set('business_name')}
              />
            </Field>
            <Field id='contact_name' label='Contact person'>
              <Input
                id='contact_name'
                maxLength={120}
                value={form.contact_name}
                onChange={set('contact_name')}
              />
            </Field>
            <Field id='phone' label='Phone'>
              <Input
                id='phone'
                type='tel'
                inputMode='tel'
                placeholder='98000 00000'
                value={form.phone}
                onChange={set('phone')}
                onBlur={() => setForm((f) => ({ ...f, phone: normalisePhone(f.phone) }))}
              />
            </Field>
            <Field id='alt_phone' label='Other phone'>
              <Input
                id='alt_phone'
                type='tel'
                inputMode='tel'
                value={form.alt_phone}
                onChange={set('alt_phone')}
                onBlur={() => setForm((f) => ({ ...f, alt_phone: normalisePhone(f.alt_phone) }))}
              />
            </Field>
            <Field id='email' label='Email'>
              <Input id='email' type='email' value={form.email} onChange={set('email')} />
            </Field>
            <Field id='city' label='City'>
              <Input id='city' maxLength={100} value={form.city} onChange={set('city')} />
            </Field>
            <Field id='area' label='Area'>
              <Input id='area' maxLength={100} value={form.area} onChange={set('area')} />
            </Field>
            <Field id='address' label='Address' wide>
              <Textarea
                id='address'
                rows={2}
                maxLength={500}
                value={form.address}
                onChange={set('address')}
              />
            </Field>
            <div className='flex flex-col gap-2 sm:col-span-2'>
              <span className='text-sm leading-none font-medium'>Location on map</span>
              <LocationPicker
                value={form.location}
                onChange={(location) => setForm((f) => ({ ...f, location }))}
                onPlace={applyPlace}
              />
            </div>
            <div className='flex flex-col gap-2 sm:col-span-2'>
              <span className='text-sm leading-none font-medium'>Photos</span>
              <PhotoPicker
                leadId={lead?.id}
                existing={photos}
                removed={removedPhotos}
                onRemovedChange={setRemovedPhotos}
                added={addedPhotos}
                onAddedChange={setAddedPhotos}
              />
            </div>
            <Field id='business_type' label='Type of business'>
              <NativeSelect
                id='business_type'
                className='w-full'
                value={form.business_type}
                onChange={set('business_type')}
              >
                <NativeSelectOption value=''>Not known</NativeSelectOption>
                {LEAD_BUSINESS_TYPES.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {BUSINESS_TYPE_LABELS[t]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field id='outlet_count' label='Outlets'>
              <Input
                id='outlet_count'
                type='number'
                min={1}
                max={10000}
                value={form.outlet_count}
                onChange={set('outlet_count')}
              />
            </Field>
            <Field id='current_pos' label='Billing today'>
              <Input
                id='current_pos'
                maxLength={100}
                placeholder='e.g. Petpooja, pen and paper'
                value={form.current_pos}
                onChange={set('current_pos')}
              />
            </Field>
            <Field id='temperature' label='Temperature'>
              <NativeSelect
                id='temperature'
                className='w-full'
                value={form.temperature}
                onChange={set('temperature')}
              >
                {LEAD_TEMPERATURES.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {TEMPERATURE_LABELS[t]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field id='source' label='Source'>
              <NativeSelect
                id='source'
                className='w-full'
                value={form.source}
                onChange={set('source')}
              >
                {LEAD_SOURCES.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field id='source_detail' label='Source detail'>
              <Input
                id='source_detail'
                maxLength={200}
                placeholder='Who referred them, which event…'
                value={form.source_detail}
                onChange={set('source_detail')}
              />
            </Field>
            {seesPlans && (
              <Field id='interested_plan_id' label='Interested in plan'>
                <NativeSelect
                  id='interested_plan_id'
                  className='w-full'
                  value={form.interested_plan_id}
                  onChange={set('interested_plan_id')}
                >
                  <NativeSelectOption value=''>Not decided</NativeSelectOption>
                  {plans.data?.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field id='expected_value' label='Expected value per month (₹)'>
              <Input
                id='expected_value'
                inputMode='decimal'
                pattern='\d{1,8}(\.\d{1,2})?'
                value={form.expected_value}
                onChange={set('expected_value')}
              />
            </Field>
            <Field id='expected_close_on' label='Expected to close by'>
              <Input
                id='expected_close_on'
                type='date'
                value={form.expected_close_on}
                onChange={set('expected_close_on')}
              />
            </Field>
            {!lead && (
              <Field id='assigned_admin_id' label='Owner'>
                <NativeSelect
                  id='assigned_admin_id'
                  className='w-full'
                  value={form.assigned_admin_id}
                  onChange={set('assigned_admin_id')}
                >
                  <NativeSelectOption value=''>Unassigned</NativeSelectOption>
                  {assignees.data?.map((a) => (
                    <NativeSelectOption key={a.id} value={a.id}>
                      {a.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field id='tags' label='Tags (comma separated)' wide>
              <Input
                id='tags'
                placeholder='chain, mall, franchise'
                value={form.tags}
                onChange={set('tags')}
              />
            </Field>
          </div>

          {duplicates && <DuplicateWarning matches={duplicates} />}

          <DialogFooter>
            <Button type='button' variant='outline' onClick={close}>
              Cancel
            </Button>
            {duplicates ? (
              <Button type='button' disabled={pending} onClick={() => submit(true)}>
                {pending ? 'Adding…' : 'Add anyway'}
              </Button>
            ) : (
              <Button type='submit' disabled={pending}>
                {pending ? 'Saving…' : lead ? 'Save' : 'Add lead'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
