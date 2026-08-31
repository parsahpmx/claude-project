DROP INDEX "endpoints_route_unique";--> statement-breakpoint
ALTER TABLE "endpoints" ALTER COLUMN "method" SET DATA TYPE "public"."http_method" USING "method"::"public"."http_method";--> statement-breakpoint
CREATE UNIQUE INDEX "endpoints_route_unique" ON "endpoints" USING btree ("project_id","environment","method","normalized_path");--> statement-breakpoint
ALTER TABLE "endpoints" DROP COLUMN "active";