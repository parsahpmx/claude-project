CREATE TYPE "public"."settlement_config_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."settlement_protocol" AS ENUM('test', 'x402');--> statement-breakpoint
CREATE TABLE "payment_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"payment_request_id" text NOT NULL,
	"protocol" text NOT NULL,
	"protocol_version" integer NOT NULL,
	"scheme" text NOT NULL,
	"chain_id" integer NOT NULL,
	"asset_address" text NOT NULL,
	"payer_address" text NOT NULL,
	"authorization_nonce" text NOT NULL,
	"valid_after" timestamp with time zone,
	"valid_before" timestamp with time zone,
	"facilitator" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"chain_id" integer NOT NULL,
	"asset_symbol" text NOT NULL,
	"recipient_address" text NOT NULL,
	"status" "settlement_config_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "settlement_protocol" "settlement_protocol" DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_configurations" ADD CONSTRAINT "settlement_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_configurations" ADD CONSTRAINT "settlement_configurations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_configurations" ADD CONSTRAINT "settlement_configurations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_configurations" ADD CONSTRAINT "settlement_configurations_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_authorizations_unique" ON "payment_authorizations" USING btree ("chain_id","asset_address","payer_address","authorization_nonce");--> statement-breakpoint
CREATE INDEX "payment_authorizations_request_idx" ON "payment_authorizations" USING btree ("payment_request_id");--> statement-breakpoint
CREATE INDEX "payment_authorizations_payer_idx" ON "payment_authorizations" USING btree ("organization_id","payer_address");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_config_project_unique" ON "settlement_configurations" USING btree ("organization_id","project_id","chain_id","asset_symbol") WHERE "settlement_configurations"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_config_org_unique" ON "settlement_configurations" USING btree ("organization_id","chain_id","asset_symbol") WHERE "settlement_configurations"."project_id" IS NULL;--> statement-breakpoint
CREATE INDEX "settlement_config_org_idx" ON "settlement_configurations" USING btree ("organization_id","chain_id");