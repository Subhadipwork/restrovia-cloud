CREATE TABLE "store_email_verifications" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"verified_address" "citext",
	"verified_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"token_hash" "bytea",
	"token_address" "citext",
	"token_expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "store_email_verifications" ADD CONSTRAINT "store_email_verifications_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;