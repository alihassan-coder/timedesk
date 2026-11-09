DROP INDEX "time_entries_one_running_per_user";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "custom_color" text;--> statement-breakpoint
CREATE INDEX "time_entries_running_idx" ON "time_entries" USING btree ("user_id") WHERE "time_entries"."ended_at" is null and "time_entries"."deleted_at" is null;