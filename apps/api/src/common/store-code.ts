/** The short store code owners, the POS and support use to name a store. */
export const storeCode = (storeId: string) => storeId.replace(/-/g, '').slice(0, 8).toUpperCase();
