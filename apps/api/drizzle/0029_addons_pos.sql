ALTER TABLE "stores" ADD COLUMN "addons_grandfathered_at" timestamp with time zone;
--> statement-breakpoint
INSERT INTO "addons" ("code", "name", "tagline", "category", "kind", "price", "interval", "unit", "trial_days", "status", "sort_order", "is_featured") VALUES
	('whatsapp', 'WhatsApp delivery', 'Send bills and offers on WhatsApp.', 'channels', 'paid', '499.00', 'month', 'outlet', 14, 'live', 10, true),
	('tableside', 'Tableside Ordering', 'Waiters take orders at the table on their phones.', 'operations', 'free', '0', 'none', 'outlet', 0, 'live', 20, false),
	('kiosk', 'Self-order kiosk', 'Customers order and pay at a kiosk screen.', 'channels', 'per_unit', '499.00', 'month', 'kiosk', 0, 'draft', 30, false)
ON CONFLICT ("code") DO NOTHING;
