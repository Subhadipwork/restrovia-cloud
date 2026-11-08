CREATE TABLE "owner_email_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"email" "citext" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_email_tokens_purpose_check" CHECK ("owner_email_tokens"."purpose" in ('verify_email', 'reset_password', 'change_email'))
);
--> statement-breakpoint
CREATE TABLE "owner_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_security_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"action" text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_invites" ALTER COLUMN "phone_e164" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "owners" ALTER COLUMN "phone_e164" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "owners" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "owners" ALTER COLUMN "password_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_invites" ADD COLUMN "email" "citext" NOT NULL;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "totp_secret_enc" "bytea";--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "failed_logins" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "owner_email_tokens" ADD CONSTRAINT "owner_email_tokens_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_recovery_codes" ADD CONSTRAINT "owner_recovery_codes_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_security_events" ADD CONSTRAINT "owner_security_events_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_email_tokens_token_key" ON "owner_email_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "owner_email_tokens_owner_idx" ON "owner_email_tokens" USING btree ("owner_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "owner_recovery_codes_owner_idx" ON "owner_recovery_codes" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "owner_security_events_owner_idx" ON "owner_security_events" USING btree ("owner_id","created_at");