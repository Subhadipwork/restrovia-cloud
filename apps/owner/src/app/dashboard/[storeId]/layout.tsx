import { StoreGate } from '@/features/stores/store-gate';

export default async function StoreLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  return <StoreGate storeId={storeId}>{children}</StoreGate>;
}
