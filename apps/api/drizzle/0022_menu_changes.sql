CREATE TABLE "menu_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"op" text NOT NULL,
	"entity_id" text,
	"label" text NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by" uuid,
	"requested_by_name" text DEFAULT '' NOT NULL,
	"command_id" uuid,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	CONSTRAINT "menu_changes_status_check" CHECK ("menu_changes"."status" in ('draft', 'pending', 'applied', 'conflict', 'rejected', 'expired')),
	CONSTRAINT "menu_changes_entity_check" CHECK ("menu_changes"."entity" in ('item', 'category')),
	CONSTRAINT "menu_changes_op_check" CHECK ("menu_changes"."op" in ('create', 'update', 'delete'))
);
--> statement-breakpoint
ALTER TABLE "menu_changes" ADD CONSTRAINT "menu_changes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_changes" ADD CONSTRAINT "menu_changes_command_id_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."commands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_changes_store_status_idx" ON "menu_changes" USING btree ("store_id","status","created_at");