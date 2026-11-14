CREATE TABLE "store_menu_items" (
	"menu_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"price" numeric(12, 2),
	"hidden" boolean DEFAULT false NOT NULL,
	CONSTRAINT "store_menu_items_menu_id_item_id_pk" PRIMARY KEY("menu_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "store_menu_variants" (
	"menu_id" uuid NOT NULL,
	"variant_id" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	CONSTRAINT "store_menu_variants_menu_id_variant_id_pk" PRIMARY KEY("menu_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "store_menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"slug" text,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_menu_items" ADD CONSTRAINT "store_menu_items_menu_id_store_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."store_menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_menu_variants" ADD CONSTRAINT "store_menu_variants_menu_id_store_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."store_menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_menus" ADD CONSTRAINT "store_menus_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_menus_store_slug_idx" ON "store_menus" USING btree ("store_id","slug");--> statement-breakpoint
CREATE INDEX "store_menus_store_idx" ON "store_menus" USING btree ("store_id","sort_order");