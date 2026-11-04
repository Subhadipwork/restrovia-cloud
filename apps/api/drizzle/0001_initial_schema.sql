CREATE TABLE "pos_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"pos_hash" text NOT NULL,
	"api_key_lookup" "bytea" NOT NULL,
	"api_key_enc" "bytea" NOT NULL,
	"device_secret_hash" text NOT NULL,
	"device_name" text,
	"platform" text,
	"arch" text,
	"app_version" text,
	"run_mode" text,
	"install_source" text,
	"last_heartbeat_at" timestamp with time zone,
	"last_ip" "inet",
	"active_orders" integer DEFAULT 0 NOT NULL,
	"today_bills" integer DEFAULT 0 NOT NULL,
	"today_sales" numeric(14, 2) DEFAULT '0' NOT NULL,
	"features" jsonb DEFAULT '{"cloud_sync_enabled":true,"cloud_orders_enabled":true,"cloud_reports_enabled":true}'::jsonb NOT NULL,
	"diagnostics_consent" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_nonces" (
	"device_id" uuid NOT NULL,
	"nonce" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_nonces_device_id_nonce_pk" PRIMARY KEY("device_id","nonce")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"contact_name" text,
	"email" "citext",
	"phone" text,
	"country" char(2),
	"currency" char(3),
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"business_day_start" time DEFAULT '00:00' NOT NULL,
	"address" text,
	"store_type" text DEFAULT 'cafe' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "stores_status_check" CHECK ("stores"."status" in ('active', 'suspended', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "daily_store_stats" (
	"store_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"bills_count" integer DEFAULT 0 NOT NULL,
	"cancelled_count" integer DEFAULT 0 NOT NULL,
	"gross_sales" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_sales" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"avg_bill" numeric(14, 2) DEFAULT '0' NOT NULL,
	"by_type" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by_hour" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_store_stats_store_id_business_date_pk" PRIMARY KEY("store_id","business_date")
);
--> statement-breakpoint
CREATE TABLE "order_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"pos_bill_id" bigint,
	"bill_number" text,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"payment_status" text,
	"paid_at" timestamp with time zone,
	"split_label" text
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"pos_item_id" bigint,
	"product_name" text NOT NULL,
	"product_sku" text,
	"variant_id" bigint,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text,
	"voided_at" timestamp with time zone,
	"business_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"device_id" uuid,
	"pos_order_id" bigint NOT NULL,
	"order_number" text,
	"type" text,
	"online_platform" text,
	"external_order_id" text,
	"status" text,
	"table_name" text,
	"guest_count" integer,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"packaging_charge" numeric(14, 2) DEFAULT '0' NOT NULL,
	"delivery_charge" numeric(14, 2) DEFAULT '0' NOT NULL,
	"service_charge" numeric(14, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"payment_status" text,
	"business_date" date NOT NULL,
	"pos_created_at" timestamp with time zone NOT NULL,
	"pos_updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"snapshot" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"device_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"store_id" uuid NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_events_device_id_event_id_pk" PRIMARY KEY("device_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" uuid,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "commands_status_check" CHECK ("commands"."status" in ('queued', 'sent', 'done', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"daily_summary_whatsapp" boolean DEFAULT false NOT NULL,
	"daily_summary_email" boolean DEFAULT false NOT NULL,
	"offline_alert" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"ip" "inet",
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_codes_purpose_check" CHECK ("otp_codes"."purpose" in ('login', 'verify_phone')),
	CONSTRAINT "otp_codes_attempts_check" CHECK ("otp_codes"."attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "owner_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"role" text DEFAULT 'manager' NOT NULL,
	"invited_by" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_invites_role_check" CHECK ("owner_invites"."role" in ('owner', 'manager'))
);
--> statement-breakpoint
CREATE TABLE "owner_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"user_agent" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone_e164" text NOT NULL,
	"email" "citext",
	"password_hash" text,
	"phone_verified_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owners_status_check" CHECK ("owners"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_members" (
	"store_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"role" text NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_members_store_id_owner_id_pk" PRIMARY KEY("store_id","owner_id"),
	CONSTRAINT "store_members_role_check" CHECK ("store_members"."role" in ('owner', 'manager'))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"interval" text NOT NULL,
	"max_devices" integer DEFAULT 1 NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_interval_check" CHECK ("plans"."interval" in ('month', 'year')),
	CONSTRAINT "plans_price_check" CHECK ("plans"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"method" text NOT NULL,
	"gateway_ref" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"recorded_by_admin" uuid,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_payments_method_check" CHECK ("subscription_payments"."method" in ('manual', 'razorpay')),
	CONSTRAINT "subscription_payments_status_check" CHECK ("subscription_payments"."status" in ('paid', 'refunded'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"plan_id" uuid,
	"status" text NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"notes" text,
	"created_by_admin" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('trial', 'active', 'past_due', 'expired', 'suspended', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" "bytea",
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_role_check" CHECK ("admins"."role" in ('super_admin', 'support', 'sales')),
	CONSTRAINT "admins_status_check" CHECK ("admins"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "data_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "data_deletion_requests_status_check" CHECK ("data_deletion_requests"."status" in ('pending', 'cancelled', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "store_diagnostics" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"reason_code" text,
	"severity" text,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_ticket_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"admin_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"client_ticket_id" text NOT NULL,
	"support_code" text NOT NULL,
	"category" text,
	"message" text DEFAULT '' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "support_tickets_status_check" CHECK ("support_tickets"."status" in ('open', 'in_progress', 'waiting', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_nonces" ADD CONSTRAINT "request_nonces_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_store_stats" ADD CONSTRAINT "daily_store_stats_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_bills" ADD CONSTRAINT "order_bills_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_bills" ADD CONSTRAINT "order_bills_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_invites" ADD CONSTRAINT "owner_invites_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_invites" ADD CONSTRAINT "owner_invites_invited_by_owners_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_sessions" ADD CONSTRAINT "owner_sessions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_claimed_by_owners_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."owners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_invited_by_owners_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."owners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_recorded_by_admin_admins_id_fk" FOREIGN KEY ("recorded_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_created_by_admin_admins_id_fk" FOREIGN KEY ("created_by_admin") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_diagnostics" ADD CONSTRAINT "store_diagnostics_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_diagnostics" ADD CONSTRAINT "store_diagnostics_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_notes" ADD CONSTRAINT "support_ticket_notes_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_notes" ADD CONSTRAINT "support_ticket_notes_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_admin_id_admins_id_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_devices_pos_hash_key" ON "pos_devices" USING btree ("pos_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_devices_api_key_lookup_key" ON "pos_devices" USING btree ("api_key_lookup");--> statement-breakpoint
CREATE INDEX "pos_devices_store_idx" ON "pos_devices" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "pos_devices_heartbeat_idx" ON "pos_devices" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "request_nonces_seen_idx" ON "request_nonces" USING btree ("seen_at");--> statement-breakpoint
CREATE INDEX "stores_status_idx" ON "stores" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stores_name_lower_idx" ON "stores" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "order_bills_order_idx" ON "order_bills" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_store_business_date_idx" ON "order_items" USING btree ("store_id","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_store_pos_order_key" ON "orders" USING btree ("store_id","pos_order_id");--> statement-breakpoint
CREATE INDEX "orders_store_business_date_idx" ON "orders" USING btree ("store_id","business_date");--> statement-breakpoint
CREATE INDEX "orders_store_open_idx" ON "orders" USING btree ("store_id","status") WHERE "orders"."status" not in ('completed', 'cancelled');--> statement-breakpoint
CREATE INDEX "orders_store_number_idx" ON "orders" USING btree ("store_id","order_number");--> statement-breakpoint
CREATE INDEX "sync_events_store_received_idx" ON "sync_events" USING btree ("store_id","received_at");--> statement-breakpoint
CREATE INDEX "commands_device_status_idx" ON "commands" USING btree ("device_id","status","created_at");--> statement-breakpoint
CREATE INDEX "otp_codes_phone_created_idx" ON "otp_codes" USING btree ("phone_e164","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_invites_token_key" ON "owner_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_sessions_token_key" ON "owner_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "owner_sessions_owner_idx" ON "owner_sessions" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owners_phone_key" ON "owners" USING btree ("phone_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "owners_email_key" ON "owners" USING btree ("email");--> statement-breakpoint
CREATE INDEX "pairing_codes_code_idx" ON "pairing_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "store_members_owner_idx" ON "store_members" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_key" ON "plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "subscription_payments_subscription_idx" ON "subscription_payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_current_per_store" ON "subscriptions" USING btree ("store_id") WHERE "subscriptions"."status" in ('trial', 'active', 'past_due');--> statement-breakpoint
CREATE INDEX "subscriptions_store_idx" ON "subscriptions" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_admin_idx" ON "admin_audit_log" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_log_target_idx" ON "admin_audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_key" ON "admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_idx" ON "admin_sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admins_email_key" ON "admins" USING btree ("email");--> statement-breakpoint
CREATE INDEX "data_deletion_requests_due_idx" ON "data_deletion_requests" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "store_diagnostics_device_event_key" ON "store_diagnostics" USING btree ("device_id","event_id");--> statement-breakpoint
CREATE INDEX "store_diagnostics_store_received_idx" ON "store_diagnostics" USING btree ("store_id","received_at");--> statement-breakpoint
CREATE INDEX "support_ticket_notes_ticket_idx" ON "support_ticket_notes" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_device_client_key" ON "support_tickets" USING btree ("device_id","client_ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_code_key" ON "support_tickets" USING btree ("support_code");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_store_idx" ON "support_tickets" USING btree ("store_id");