'use client';

import { IconPhotoPlus, IconX } from '@tabler/icons-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { leadPhotoUrl, MAX_LEAD_PHOTOS } from './api';

const MAX_SIDE_PX = 1600;
const MAX_BYTES = 1_400_000;

/** A photo chosen in this form, shrunk to JPEG before upload so phone pictures stay small. */
export type NewPhoto = { key: string; blob: Blob; url: string };

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('too large');
}

const tile = 'relative aspect-square overflow-hidden rounded-md border bg-muted';

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type='button'
      aria-label={label}
      onClick={onClick}
      className='bg-background/90 hover:bg-background absolute top-1 right-1 rounded-full p-1 shadow'
    >
      <IconX className='size-3.5' />
    </button>
  );
}

/** Existing photos (removable) plus new ones; nothing is uploaded until the form is saved. */
export function PhotoPicker({
  leadId,
  existing,
  removed,
  onRemovedChange,
  added,
  onAddedChange
}: {
  leadId?: string;
  existing: { id: string }[];
  removed: string[];
  onRemovedChange: (ids: string[]) => void;
  added: NewPhoto[];
  onAddedChange: (photos: NewPhoto[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const kept = existing.filter((p) => !removed.includes(p.id));
  const room = MAX_LEAD_PHOTOS - kept.length - added.length;

  const urls = useRef(added.map((p) => p.url));
  useEffect(() => {
    urls.current = added.map((p) => p.url);
  }, [added]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const pick = async (files: FileList | null) => {
    const chosen = [...(files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!chosen.length) return;
    if (chosen.length > room) {
      toast.error(`A lead can have up to ${MAX_LEAD_PHOTOS} photos.`);
    }
    setBusy(true);
    const next: NewPhoto[] = [];
    for (const file of chosen.slice(0, Math.max(0, room))) {
      try {
        const blob = await shrink(file);
        next.push({ key: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) });
      } catch {
        toast.error(`Couldn’t read ${file.name}. Try a JPEG or PNG photo.`);
      }
    }
    setBusy(false);
    onAddedChange([...added, ...next]);
  };

  return (
    <div className='flex flex-col gap-2'>
      <div className='grid grid-cols-4 gap-2 sm:grid-cols-6'>
        {leadId &&
          kept.map((p, i) => (
            <div key={p.id} className={tile}>
              <Image
                src={leadPhotoUrl(leadId, p.id)}
                alt={`Saved upload ${i + 1}`}
                fill
                unoptimized
                sizes='96px'
                className='object-cover'
              />
              <RemoveButton
                label={`Remove saved upload ${i + 1}`}
                onClick={() => onRemovedChange([...removed, p.id])}
              />
            </div>
          ))}
        {added.map((p, i) => (
          <div key={p.key} className={tile}>
            <Image
              src={p.url}
              alt={`New upload ${i + 1}`}
              fill
              unoptimized
              sizes='96px'
              className='object-cover'
            />
            <RemoveButton
              label={`Remove new upload ${i + 1}`}
              onClick={() => {
                URL.revokeObjectURL(p.url);
                onAddedChange(added.filter((x) => x.key !== p.key));
              }}
            />
          </div>
        ))}
        {room > 0 && (
          <Button
            type='button'
            variant='outline'
            className='aspect-square h-auto flex-col gap-1 text-xs'
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <IconPhotoPlus className='size-5' />
            {busy ? 'Adding…' : 'Add photo'}
          </Button>
        )}
      </div>
      <input
        ref={input}
        type='file'
        accept='image/*'
        multiple
        hidden
        onChange={(e) => {
          void pick(e.target.files);
          e.target.value = '';
        }}
      />
      <p className='text-muted-foreground text-xs'>
        Shopfront, menu board or counter. Up to {MAX_LEAD_PHOTOS} photos; large photos are shrunk
        before upload.
      </p>
    </div>
  );
}
