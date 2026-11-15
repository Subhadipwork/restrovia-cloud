CREATE TABLE "menu_snapshots" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"portal_editing" boolean DEFAULT true NOT NULL,
	"hash" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"data" jsonb,
	"pos_generated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "menu_snapshots" ADD CONSTRAINT "menu_snapshots_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_snapshots" ADD CONSTRAINT "menu_snapshots_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE set null ON UPDATE no action;