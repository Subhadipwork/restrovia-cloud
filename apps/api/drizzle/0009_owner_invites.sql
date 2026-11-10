ALTER TABLE "owner_email_tokens" DROP CONSTRAINT "owner_email_tokens_purpose_check";--> statement-breakpoint
DELETE FROM "owner_email_tokens" WHERE "purpose" = 'verify_email';--> statement-breakpoint
ALTER TABLE "owners" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "created_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "owners" ADD CONSTRAINT "owners_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_email_tokens" ADD CONSTRAINT "owner_email_tokens_purpose_check" CHECK ("owner_email_tokens"."purpose" in ('invite', 'reset_password', 'change_email'));