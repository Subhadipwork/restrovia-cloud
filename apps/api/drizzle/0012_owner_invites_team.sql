ALTER TABLE "owner_invites" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "owner_invites" ADD COLUMN "sent_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_invites" ADD COLUMN "sends" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_invites_open_key" ON "owner_invites" USING btree ("store_id","email") WHERE "owner_invites"."accepted_at" is null and "owner_invites"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "owner_invites_store_idx" ON "owner_invites" USING btree ("store_id","created_at");