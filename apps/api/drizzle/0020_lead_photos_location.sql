CREATE TABLE "lead_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_by_admin" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_photos_type_check" CHECK ("lead_photos"."content_type" in ('image/jpeg', 'image/png', 'image/webp'))
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "lead_photos" ADD CONSTRAINT "lead_photos_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_photos" ADD CONSTRAINT "lead_photos_created_by_admin_admins_id_fk" FOREIGN KEY ("created_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_photos_lead_idx" ON "lead_photos" USING btree ("lead_id","created_at");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_location_check" CHECK (("leads"."latitude" is null) = ("leads"."longitude" is null) and ("leads"."latitude" is null or ("leads"."latitude" between -90 and 90 and "leads"."longitude" between -180 and 180)));