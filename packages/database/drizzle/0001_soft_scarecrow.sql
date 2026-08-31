CREATE TYPE "public"."api_key_status" AS ENUM('ACTIVE', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('ACTIVE', 'INVITED', 'SUSPENDED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('ACTIVE', 'SUSPENDED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('ACTIVE', 'ARCHIVED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED', 'PENDING_VERIFICATION');--> statement-breakpoint
DROP INDEX "users_email_unique";--> statement-breakpoint
DROP INDEX "api_keys_prefix_idx";--> statement-breakpoint
DROP INDEX "api_keys_project_idx";--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "status" "membership_status" DEFAULT 'INVITED' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "status" "organization_status" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "status" "project_status" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
-- Backfill-safe three-step. The generated form was a bare NOT NULL add,
-- which fails on any table that already has rows. Adding nullable,
-- backfilling from the existing address, then tightening the constraint
-- reaches the same final schema and is safe to run against real data.
ALTER TABLE "users" ADD COLUMN "email_normalized" text;--> statement-breakpoint
UPDATE "users" SET "email_normalized" = lower(btrim("email")) WHERE "email_normalized" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email_normalized" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" "user_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "status" "api_key_status" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "rotated_from_key_id" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_members_org_role_status_idx" ON "organization_members" USING btree ("organization_id","role","status");--> statement-breakpoint
CREATE INDEX "organizations_status_idx" ON "organizations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_org_status_idx" ON "projects" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_unique" ON "users" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "api_keys_project_status_idx" ON "api_keys" USING btree ("project_id","status");