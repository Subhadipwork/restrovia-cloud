CREATE TABLE "pos_backups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"destination" text NOT NULL,
	"status" text NOT NULL,
	"file_name" text,
	"size_bytes" bigint,
	"error" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_backups_destination_check" CHECK ("pos_backups"."destination" in ('local', 'google_drive', 'other')),
	CONSTRAINT "pos_backups_status_check" CHECK ("pos_backups"."status" in ('success', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "pos_presence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_by_admin" uuid,
	"lifted_at" timestamp with time zone,
	"lifted_by_admin" uuid
);
--> statement-breakpoint
ALTER TABLE "pos_backups" ADD CONSTRAINT "pos_backups_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_backups" ADD CONSTRAINT "pos_backups_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_presence" ADD CONSTRAINT "pos_presence_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_presence" ADD CONSTRAINT "pos_presence_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_blocks" ADD CONSTRAINT "store_blocks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_blocks" ADD CONSTRAINT "store_blocks_blocked_by_admin_admins_id_fk" FOREIGN KEY ("blocked_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_blocks" ADD CONSTRAINT "store_blocks_lifted_by_admin_admins_id_fk" FOREIGN KEY ("lifted_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_backups_device_event_key" ON "pos_backups" USING btree ("device_id","event_id");--> statement-breakpoint
CREATE INDEX "pos_backups_store_occurred_idx" ON "pos_backups" USING btree ("store_id","occurred_at");--> statement-breakpoint
CREATE INDEX "pos_presence_device_seen_idx" ON "pos_presence" USING btree ("device_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "pos_presence_store_seen_idx" ON "pos_presence" USING btree ("store_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "store_blocks_one_open_key" ON "store_blocks" USING btree ("store_id") WHERE "store_blocks"."lifted_at" is null;--> statement-breakpoint
CREATE INDEX "store_blocks_store_idx" ON "store_blocks" USING btree ("store_id","blocked_at");