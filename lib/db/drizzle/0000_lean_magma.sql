CREATE TYPE "public"."attendance_event_type" AS ENUM('check_in', 'check_out', 'geofence_enter', 'geofence_exit', 'heartbeat');--> statement-breakpoint
CREATE TYPE "public"."checkout_reason" AS ENUM('manual', 'auto_geofence_exit', 'auto_heartbeat_lost', 'auto_workday_end', 'admin_override');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('online', 'offline', 'background', 'system');--> statement-breakpoint
CREATE TYPE "public"."qr_mode" AS ENUM('rotating', 'static');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('checked_in', 'pending_exit', 'checked_out', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."signal_type" AS ENUM('gps_unavailable', 'gps_accuracy_poor', 'location_services_disabled', 'permission_revoked', 'background_permission_missing', 'battery_optimisation_active', 'device_offline', 'app_terminated', 'mock_location_detected', 'impossible_travel', 'provider_toggle_churn', 'duplicate_coordinates', 'unknown_device');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'company_admin', 'manager', 'employee');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" DEFAULT 'employee' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workplaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"radius_m" integer DEFAULT 150 NOT NULL,
	"exit_buffer_m" integer DEFAULT 50 NOT NULL,
	"max_accuracy_m" integer DEFAULT 100 NOT NULL,
	"exit_grace_seconds" integer DEFAULT 300 NOT NULL,
	"heartbeat_timeout_seconds" integer DEFAULT 1800 NOT NULL,
	"qr_mode" "qr_mode" DEFAULT 'rotating' NOT NULL,
	"qr_secret" text NOT NULL,
	"qr_rotation_seconds" integer DEFAULT 30 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"work_start" time DEFAULT '09:00:00' NOT NULL,
	"work_end" time DEFAULT '17:00:00' NOT NULL,
	"late_grace_minutes" integer DEFAULT 10 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_workplaces" (
	"employee_id" uuid NOT NULL,
	"workplace_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_workplaces_employee_id_workplace_id_pk" PRIMARY KEY("employee_id","workplace_id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"department_id" uuid,
	"manager_id" uuid,
	"employee_code" text NOT NULL,
	"job_title" text,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"manager_user_id" uuid NOT NULL,
	"department_id" uuid,
	"workplace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"session_id" uuid,
	"workplace_id" uuid,
	"client_event_id" text NOT NULL,
	"client_sequence" integer DEFAULT 0 NOT NULL,
	"event_type" "attendance_event_type" NOT NULL,
	"source" "event_source" DEFAULT 'online' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"accuracy_m" double precision,
	"distance_m" double precision,
	"is_inside" boolean,
	"is_mock_location" boolean DEFAULT false NOT NULL,
	"device_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"workplace_id" uuid NOT NULL,
	"status" "session_status" DEFAULT 'checked_in' NOT NULL,
	"check_in_at" timestamp with time zone NOT NULL,
	"check_out_at" timestamp with time zone,
	"checkout_reason" "checkout_reason",
	"exit_detected_at" timestamp with time zone,
	"exit_grace_until" timestamp with time zone,
	"last_inside_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"duration_minutes" integer,
	"is_late" boolean DEFAULT false NOT NULL,
	"late_by_minutes" integer,
	"is_early_departure" boolean DEFAULT false NOT NULL,
	"flags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"session_id" uuid,
	"signal_type" "signal_type" NOT NULL,
	"detail" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"install_id" text NOT NULL,
	"model" text,
	"os_name" text,
	"os_version" text,
	"app_version" text,
	"is_trusted" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_token_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workplaces" ADD CONSTRAINT "workplaces_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_workplaces" ADD CONSTRAINT "employee_workplaces_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_workplaces" ADD CONSTRAINT "employee_workplaces_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_scopes" ADD CONSTRAINT "manager_scopes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_scopes" ADD CONSTRAINT "manager_scopes_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_scopes" ADD CONSTRAINT "manager_scopes_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_scopes" ADD CONSTRAINT "manager_scopes_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_signals" ADD CONSTRAINT "session_signals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_signals" ADD CONSTRAINT "session_signals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_signals" ADD CONSTRAINT "session_signals_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_company_email_idx" ON "users" USING btree ("company_id","email");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_company_name_idx" ON "departments" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "workplaces_company_name_idx" ON "workplaces" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "workplaces_company_idx" ON "workplaces" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "employee_workplaces_workplace_idx" ON "employee_workplaces" USING btree ("workplace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_company_code_idx" ON "employees" USING btree ("company_id","employee_code");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_user_idx" ON "employees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "employees_company_idx" ON "employees" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "employees_department_idx" ON "employees" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "manager_scopes_user_idx" ON "manager_scopes" USING btree ("manager_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_events_dedupe_idx" ON "attendance_events" USING btree ("employee_id","client_event_id");--> statement-breakpoint
CREATE INDEX "attendance_events_session_idx" ON "attendance_events" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "attendance_events_employee_time_idx" ON "attendance_events" USING btree ("employee_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_sessions_one_open_idx" ON "attendance_sessions" USING btree ("employee_id") WHERE "attendance_sessions"."status" in ('checked_in', 'pending_exit');--> statement-breakpoint
CREATE INDEX "attendance_sessions_employee_time_idx" ON "attendance_sessions" USING btree ("employee_id","check_in_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attendance_sessions_company_time_idx" ON "attendance_sessions" USING btree ("company_id","check_in_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attendance_sessions_workplace_idx" ON "attendance_sessions" USING btree ("workplace_id");--> statement-breakpoint
CREATE INDEX "attendance_sessions_sweep_idx" ON "attendance_sessions" USING btree ("status","exit_grace_until") WHERE "attendance_sessions"."status" in ('checked_in', 'pending_exit');--> statement-breakpoint
CREATE INDEX "attendance_sessions_review_idx" ON "attendance_sessions" USING btree ("company_id") WHERE "attendance_sessions"."needs_review";--> statement-breakpoint
CREATE INDEX "session_signals_session_idx" ON "session_signals" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_signals_employee_time_idx" ON "session_signals" USING btree ("employee_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "devices_employee_install_idx" ON "devices" USING btree ("employee_id","install_id");--> statement-breakpoint
CREATE INDEX "devices_company_idx" ON "devices" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "audit_logs_company_time_idx" ON "audit_logs" USING btree ("company_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");