'use client';

import { IconExternalLink } from '@tabler/icons-react';
import Image from 'next/image';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { type Lead, leadPhotoUrl, type LeadPhoto } from './api';
import { googleMapsUrl, LocationPicker } from './location-picker';

export function LeadLocationCard({ lead }: { lead: Lead }) {
  if (!lead.latitude || !lead.longitude) return null;
  const point = { lat: Number(lead.latitude), lng: Number(lead.longitude) };
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Location</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-2'>
        <LocationPicker value={point} readOnly className='h-48' />
        <a
          href={googleMapsUrl(point)}
          target='_blank'
          rel='noopener noreferrer'
          className='text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline'
        >
          Open in Google Maps
          <IconExternalLink className='size-3.5' />
        </a>
      </CardContent>
    </Card>
  );
}

export function LeadPhotosCard({ leadId, photos }: { leadId: string; photos: LeadPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!photos.length) return null;
  const current = open === null ? undefined : photos[open];
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Photos</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='grid grid-cols-3 gap-2'>
          {photos.map((p, i) => (
            <button
              key={p.id}
              type='button'
              onClick={() => setOpen(i)}
              className='bg-muted relative aspect-square overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none'
              aria-label={`Open photo ${i + 1}`}
            >
              <Image
                src={leadPhotoUrl(leadId, p.id)}
                alt=''
                fill
                unoptimized
                sizes='120px'
                className='object-cover'
              />
            </button>
          ))}
        </div>
      </CardContent>
      <Dialog open={!!current} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className='sm:max-w-3xl'>
          <DialogTitle>
            Photo {(open ?? 0) + 1} of {photos.length}
          </DialogTitle>
          {current && (
            <Image
              src={leadPhotoUrl(leadId, current.id)}
              alt={`Upload ${(open ?? 0) + 1} of ${photos.length}`}
              width={1600}
              height={1200}
              unoptimized
              className='max-h-[70vh] w-full rounded-md object-contain'
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
