ALTER TABLE "store_members" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "store_members" SET "is_primary" = true
WHERE ("store_id", "owner_id") IN (
	SELECT DISTINCT ON ("store_id") "store_id", "owner_id"
	FROM "store_members"
	WHERE "role" = 'owner'
	ORDER BY "store_id", "created_at" ASC, "owner_id" ASC
);
