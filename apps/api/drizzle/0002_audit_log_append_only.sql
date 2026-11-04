CREATE OR REPLACE FUNCTION reject_audit_log_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER admin_audit_log_append_only
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_change();
--> statement-breakpoint
CREATE TRIGGER admin_audit_log_no_truncate
  BEFORE TRUNCATE ON admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_change();
