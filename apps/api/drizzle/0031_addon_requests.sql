CREATE TABLE "addon_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"addon_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_owner" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by_admin" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addon_requests_status_check" CHECK ("addon_requests"."status" in ('pending', 'done', 'declined', 'cancelled')),
	CONSTRAINT "addon_requests_quantity_check" CHECK ("addon_requests"."quantity" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "store_addons" ADD COLUMN "reminded_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "addon_requests" ADD CONSTRAINT "addon_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_requests" ADD CONSTRAINT "addon_requests_addon_id_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."addons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_requests" ADD CONSTRAINT "addon_requests_requested_by_owner_owners_id_fk" FOREIGN KEY ("requested_by_owner") REFERENCES "public"."owners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_requests" ADD CONSTRAINT "addon_requests_resolved_by_admin_admins_id_fk" FOREIGN KEY ("resolved_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "addon_requests_one_pending_per_store" ON "addon_requests" USING btree ("store_id","addon_id") WHERE "addon_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "addon_requests_status_idx" ON "addon_requests" USING btree ("status","created_at");