CREATE TABLE "machine_trials" (
	"machine_id_hash" text PRIMARY KEY NOT NULL,
	"store_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_link_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"machine_id_hash" text NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" uuid,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "orders_store_pos_order_key";--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "activation" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "suggested_store_id" uuid;--> statement-breakpoint
ALTER TABLE "machine_trials" ADD CONSTRAINT "machine_trials_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_link_codes" ADD CONSTRAINT "device_link_codes_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_link_codes" ADD CONSTRAINT "device_link_codes_used_by_owners_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."owners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_link_codes_code_idx" ON "device_link_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "device_link_codes_device_idx" ON "device_link_codes" USING btree ("device_id");--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_suggested_store_id_stores_id_fk" FOREIGN KEY ("suggested_store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stores_pending_idx" ON "stores" USING btree ("created_at") WHERE "stores"."activation" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "orders_store_device_pos_order_key" ON "orders" USING btree ("store_id","device_id","pos_order_id");--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_activation_check" CHECK ("stores"."activation" in ('active', 'pending'));--> statement-breakpoint
INSERT INTO "machine_trials" ("machine_id_hash", "store_id", "first_seen_at")
SELECT DISTINCT ON ("machine_id_hash") "machine_id_hash", "store_id", "created_at"
FROM "pos_devices"
WHERE "machine_id_hash" IS NOT NULL
ORDER BY "machine_id_hash", "created_at" ASC;
