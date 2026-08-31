CREATE TYPE "public"."endpoint_status" AS ENUM('ACTIVE', 'DISABLED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."http_method" AS ENUM('GET', 'POST', 'PUT', 'PATCH', 'DELETE');--> statement-breakpoint
-- Backfill-safe three-step, matching the standard set in 0001. The
-- generated form was a bare NOT NULL add, which fails on any table that
-- already has rows. The backfill mirrors normalizePath() in the API:
-- lowercase, collapse duplicate slashes, single leading slash, no
-- trailing slash.
ALTER TABLE "endpoints" ADD COLUMN "normalized_path" text;--> statement-breakpoint
UPDATE "endpoints" SET "normalized_path" = 
  COALESCE(NULLIF(regexp_replace('/' || lower(btrim("path")), '/+', '/', 'g'), ''), '/')
  WHERE "normalized_path" IS NULL;--> statement-breakpoint
UPDATE "endpoints" SET "normalized_path" = rtrim("normalized_path", '/')
  WHERE length("normalized_path") > 1 AND "normalized_path" LIKE '%/';--> statement-breakpoint
ALTER TABLE "endpoints" ALTER COLUMN "normalized_path" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "status" "endpoint_status" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD COLUMN "environment" "merchant_environment" NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD COLUMN "asset_decimals" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD COLUMN "simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "endpoint_id" text;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "environment" "merchant_environment";--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "protocol" text;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "amount_minor_units" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "asset_symbol" text;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "asset_decimals" integer;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "external_transaction_reference" text;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "pricing_rule_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "protocol" text DEFAULT 'x402' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payer_reference" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "external_transaction_reference" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "endpoints_project_status_idx" ON "endpoints" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "pricing_rules_project_env_idx" ON "pricing_rules" USING btree ("project_id","environment");