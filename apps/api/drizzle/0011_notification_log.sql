CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_log_kind_check" CHECK ("notification_log"."kind" in ('daily_summary', 'store_offline'))
);
--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_log_once_key" ON "notification_log" USING btree ("store_id","owner_id","kind","key");--> statement-breakpoint
CREATE INDEX "notification_log_sent_idx" ON "notification_log" USING btree ("sent_at");