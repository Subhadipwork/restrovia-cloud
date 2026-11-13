CREATE TABLE "admin_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_roles_key_format" CHECK ("admin_roles"."key" ~ '^[a-z][a-z0-9_]{1,39}$')
);
--> statement-breakpoint
ALTER TABLE "admins" DROP CONSTRAINT "admins_role_check";--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "role_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_roles_key_key" ON "admin_roles" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_roles_name_key" ON "admin_roles" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_role_id_admin_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."admin_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admins_role_idx" ON "admins" USING btree ("role_id");--> statement-breakpoint
-- Built-in roles; ids and permissions match SYSTEM_ROLE_IDS and SYSTEM_ROLES in @restrovia/shared.
INSERT INTO "admin_roles" ("id", "key", "name", "description", "permissions", "is_system") VALUES
  ('00000000-0000-4000-8000-000000000001', 'super_admin', 'Super admin', 'Everything, including roles and other Super admins.', ARRAY['*']::text[], true),
  ('00000000-0000-4000-8000-000000000002', 'admin', 'Admin', 'Runs operations and the team. Can’t edit roles or manage Super admins.', ARRAY['overview.view', 'stores.view', 'stores.block', 'stores.licence', 'stores.devices', 'owners.view', 'owners.invite', 'owners.manage', 'plans.view', 'plans.manage', 'tickets.view', 'tickets.manage', 'leads.view', 'leads.edit', 'leads.reports', 'leads.delete', 'leads.export', 'leads.win_override', 'users.view', 'users.manage', 'audit.view']::text[], true),
  ('00000000-0000-4000-8000-000000000003', 'manager', 'Manager', 'Leads sales and support: stores, owners, tickets, leads, reports and export.', ARRAY['overview.view', 'stores.view', 'stores.block', 'stores.licence', 'stores.devices', 'owners.view', 'owners.invite', 'owners.manage', 'plans.view', 'tickets.view', 'tickets.manage', 'leads.view', 'leads.edit', 'leads.reports', 'leads.export', 'leads.win_override', 'users.view']::text[], true),
  ('00000000-0000-4000-8000-000000000004', 'support', 'Support', 'Helps cafés: stores, owners, POS computers and tickets. Reads leads.', ARRAY['overview.view', 'stores.view', 'stores.devices', 'owners.view', 'owners.invite', 'owners.manage', 'tickets.view', 'tickets.manage', 'leads.view']::text[], true),
  ('00000000-0000-4000-8000-000000000005', 'sales', 'Sales', 'Sells: stores, licences, owner invites and leads.', ARRAY['overview.view', 'stores.view', 'stores.block', 'stores.licence', 'owners.view', 'owners.invite', 'plans.view', 'leads.view', 'leads.edit', 'leads.reports']::text[], true);
--> statement-breakpoint
-- Every existing admin keeps exactly the access they had: the old role text names a system role.
UPDATE "admins" SET "role_id" = "admin_roles"."id" FROM "admin_roles" WHERE "admin_roles"."key" = "admins"."role";
