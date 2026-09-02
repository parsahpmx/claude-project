CREATE TYPE "public"."reconciliation_status" AS ENUM('PENDING', 'IN_PROGRESS', 'RESOLVED_CONFIRMED', 'RESOLVED_FAILED', 'EXHAUSTED');--> statement-breakpoint
CREATE TABLE "settlement_reconciliations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"payment_request_id" text NOT NULL,
	"status" "reconciliation_status" DEFAULT 'PENDING' NOT NULL,
	"facilitator" text,
	"chain_id" integer NOT NULL,
	"asset_address" text NOT NULL,
	"payer_address" text NOT NULL,
	"authorization_nonce" text NOT NULL,
	"recipient_address" text NOT NULL,
	"amount_minor_units" text NOT NULL,
	"valid_before" timestamp with time zone,
	"transaction_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 12 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_result" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settlement_reconciliations" ADD CONSTRAINT "settlement_reconciliations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_reconciliations" ADD CONSTRAINT "settlement_reconciliations_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_reconciliations_request_unique" ON "settlement_reconciliations" USING btree ("payment_request_id");--> statement-breakpoint
CREATE INDEX "settlement_reconciliations_claim_idx" ON "settlement_reconciliations" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "settlement_reconciliations_org_idx" ON "settlement_reconciliations" USING btree ("organization_id","status");