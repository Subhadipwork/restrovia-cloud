CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"admin_id" uuid,
	"type" text NOT NULL,
	"outcome" text,
	"body" text DEFAULT '' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_activities_type_check" CHECK ("lead_activities"."type" in ('note', 'call', 'whatsapp', 'email', 'meeting', 'demo', 'created', 'stage_change', 'assignment', 'task_done')),
	CONSTRAINT "lead_activities_outcome_check" CHECK ("lead_activities"."outcome" is null or "lead_activities"."outcome" in ('connected', 'no_answer', 'busy', 'wrong_number', 'call_back'))
);
--> statement-breakpoint
CREATE TABLE "lead_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"assigned_admin_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_admin" uuid,
	"created_by_admin" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_tasks_type_check" CHECK ("lead_tasks"."type" in ('call', 'whatsapp', 'email', 'meeting', 'demo', 'other'))
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" text NOT NULL,
	"contact_name" text,
	"phone_e164" text,
	"alt_phone_e164" text,
	"email" "citext",
	"city" text,
	"area" text,
	"address" text,
	"business_type" text,
	"outlet_count" integer DEFAULT 1 NOT NULL,
	"current_pos" text,
	"source" text NOT NULL,
	"source_detail" text,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"temperature" text DEFAULT 'warm' NOT NULL,
	"assigned_admin_id" uuid,
	"interested_plan_id" uuid,
	"expected_value" numeric(10, 2),
	"expected_close_on" date,
	"next_follow_up_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"store_id" uuid,
	"lost_reason" text,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"consent_at" timestamp with time zone,
	"created_by_admin" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "leads_stage_check" CHECK ("leads"."stage" in ('new', 'contacted', 'qualified', 'demo_scheduled', 'demo_done', 'trial', 'negotiation', 'won', 'lost')),
	CONSTRAINT "leads_source_check" CHECK ("leads"."source" in ('website', 'walk_in', 'cold_call', 'field_visit', 'referral', 'partner', 'whatsapp', 'instagram', 'facebook', 'google_ads', 'event', 'pos_install', 'import', 'other')),
	CONSTRAINT "leads_temperature_check" CHECK ("leads"."temperature" in ('hot', 'warm', 'cold')),
	CONSTRAINT "leads_business_type_check" CHECK ("leads"."business_type" is null or "leads"."business_type" in ('cafe', 'restaurant', 'qsr', 'bakery', 'cloud_kitchen', 'bar', 'food_truck', 'other')),
	CONSTRAINT "leads_lost_reason_check" CHECK ("leads"."lost_reason" is null or "leads"."lost_reason" in ('price', 'chose_competitor', 'no_response', 'not_a_fit', 'closed_business', 'timing', 'missing_feature', 'duplicate', 'other')),
	CONSTRAINT "leads_outlet_count_check" CHECK ("leads"."outlet_count" >= 1),
	CONSTRAINT "leads_lost_needs_reason" CHECK ("leads"."stage" <> 'lost' or "leads"."lost_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_assigned_admin_id_admins_id_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_done_by_admin_admins_id_fk" FOREIGN KEY ("done_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_created_by_admin_admins_id_fk" FOREIGN KEY ("created_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_admin_id_admins_id_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_interested_plan_id_plans_id_fk" FOREIGN KEY ("interested_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_admin_admins_id_fk" FOREIGN KEY ("created_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_activities_lead_idx" ON "lead_activities" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lead_tasks_assigned_idx" ON "lead_tasks" USING btree ("assigned_admin_id","done_at","due_at");--> statement-breakpoint
CREATE INDEX "lead_tasks_lead_idx" ON "lead_tasks" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("stage","updated_at");--> statement-breakpoint
CREATE INDEX "leads_assigned_idx" ON "leads" USING btree ("assigned_admin_id","stage");--> statement-breakpoint
CREATE INDEX "leads_follow_up_idx" ON "leads" USING btree ("next_follow_up_at") WHERE "leads"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "leads_alt_phone_idx" ON "leads" USING btree ("alt_phone_e164");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "leads_store_idx" ON "leads" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "leads_name_lower_idx" ON "leads" USING btree (lower("business_name"));--> statement-breakpoint
CREATE INDEX "leads_city_lower_idx" ON "leads" USING btree (lower("city"));--> statement-breakpoint
CREATE INDEX "leads_tags_idx" ON "leads" USING gin ("tags");