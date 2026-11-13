CREATE TABLE "admin_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by_admin" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_tokens_purpose_check" CHECK ("admin_tokens"."purpose" in ('invite', 'password_reset'))
);
--> statement-breakpoint
ALTER TABLE "admins" DROP CONSTRAINT "admins_status_check";--> statement-breakpoint
ALTER TABLE "admins" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "invited_by_admin" uuid;--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_tokens" ADD CONSTRAINT "admin_tokens_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_tokens" ADD CONSTRAINT "admin_tokens_created_by_admin_admins_id_fk" FOREIGN KEY ("created_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_tokens_token_key" ON "admin_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_tokens_admin_idx" ON "admin_tokens" USING btree ("admin_id","purpose","created_at");--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_invited_by_admin_admins_id_fk" FOREIGN KEY ("invited_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_password_unless_invited" CHECK ("admins"."status" = 'invited' or "admins"."password_hash" is not null);--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_status_check" CHECK ("admins"."status" in ('invited', 'active', 'disabled'));