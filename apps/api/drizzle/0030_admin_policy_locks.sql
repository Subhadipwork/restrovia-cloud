CREATE TABLE "store_policy_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"pos_device_id" uuid,
	"key" text NOT NULL,
	"mode" text DEFAULT 'read_only' NOT NULL,
	"effect" text DEFAULT 'lock' NOT NULL,
	"reason" text NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by_admin" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_policy_locks_key_check" CHECK ("store_policy_locks"."key" in ('page:/inventory', 'page:/expenses', 'page:/products', 'page:/whatsapp', 'settings:*', 'settings:whatsapp', 'settings:server-app', 'settings:kiosks', 'settings:qr-menu', 'settings:loyalty')),
	CONSTRAINT "store_policy_locks_mode_check" CHECK ("store_policy_locks"."mode" in ('hidden', 'read_only')),
	CONSTRAINT "store_policy_locks_effect_check" CHECK ("store_policy_locks"."effect" in ('lock', 'unlock')),
	CONSTRAINT "store_policy_locks_unlock_store_check" CHECK ("store_policy_locks"."effect" = 'lock' or "store_policy_locks"."pos_device_id" is null)
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "policy_rev" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "locks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "store_policy_locks" ADD CONSTRAINT "store_policy_locks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_policy_locks" ADD CONSTRAINT "store_policy_locks_pos_device_id_pos_devices_id_fk" FOREIGN KEY ("pos_device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_policy_locks" ADD CONSTRAINT "store_policy_locks_created_by_admin_admins_id_fk" FOREIGN KEY ("created_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_policy_locks_store_idx" ON "store_policy_locks" USING btree ("store_id");