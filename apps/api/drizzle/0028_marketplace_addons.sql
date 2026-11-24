CREATE TABLE "addon_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_addon_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"method" text NOT NULL,
	"gateway_ref" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"recorded_by_admin" uuid,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addon_payments_method_check" CHECK ("addon_payments"."method" in ('manual', 'razorpay')),
	CONSTRAINT "addon_payments_status_check" CHECK ("addon_payments"."status" in ('paid', 'refunded')),
	CONSTRAINT "addon_payments_amount_check" CHECK ("addon_payments"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"kind" text NOT NULL,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"interval" text DEFAULT 'none' NOT NULL,
	"unit" text DEFAULT 'outlet' NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"requires" text[] DEFAULT '{}'::text[] NOT NULL,
	"min_pos_version" text,
	"scope" text DEFAULT 'pos' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addons_kind_check" CHECK ("addons"."kind" in ('included', 'free', 'paid', 'per_unit', 'usage', 'one_time', 'contact')),
	CONSTRAINT "addons_category_check" CHECK ("addons"."category" in ('channels', 'operations', 'money', 'marketing', 'reports', 'services')),
	CONSTRAINT "addons_interval_check" CHECK ("addons"."interval" in ('month', 'year', 'once', 'none')),
	CONSTRAINT "addons_unit_check" CHECK ("addons"."unit" in ('outlet', 'device', 'kiosk', 'screen', 'pack')),
	CONSTRAINT "addons_scope_check" CHECK ("addons"."scope" in ('pos', 'cloud', 'both')),
	CONSTRAINT "addons_status_check" CHECK ("addons"."status" in ('draft', 'beta', 'live', 'retired')),
	CONSTRAINT "addons_price_check" CHECK ("addons"."price" >= 0),
	CONSTRAINT "addons_trial_days_check" CHECK ("addons"."trial_days" between 0 and 90)
);
--> statement-breakpoint
CREATE TABLE "store_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"addon_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"granted_by_admin" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_addons_status_check" CHECK ("store_addons"."status" in ('trial', 'active', 'cancelled', 'expired', 'revoked')),
	CONSTRAINT "store_addons_source_check" CHECK ("store_addons"."source" in ('purchase', 'free', 'admin_grant', 'grandfathered')),
	CONSTRAINT "store_addons_quantity_check" CHECK ("store_addons"."quantity" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "addon_payments" ADD CONSTRAINT "addon_payments_store_addon_id_store_addons_id_fk" FOREIGN KEY ("store_addon_id") REFERENCES "public"."store_addons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_payments" ADD CONSTRAINT "addon_payments_recorded_by_admin_admins_id_fk" FOREIGN KEY ("recorded_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_addons" ADD CONSTRAINT "store_addons_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_addons" ADD CONSTRAINT "store_addons_addon_id_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."addons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_addons" ADD CONSTRAINT "store_addons_granted_by_admin_admins_id_fk" FOREIGN KEY ("granted_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addon_payments_store_addon_idx" ON "addon_payments" USING btree ("store_addon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "addons_code_key" ON "addons" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "store_addons_one_current_per_store" ON "store_addons" USING btree ("store_id","addon_id") WHERE "store_addons"."status" in ('trial', 'active', 'cancelled');--> statement-breakpoint
CREATE INDEX "store_addons_store_idx" ON "store_addons" USING btree ("store_id");