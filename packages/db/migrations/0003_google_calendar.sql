CREATE TABLE "google_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"encrypted_access_token" text,
	"access_expires_at" timestamp with time zone,
	"push_tasks" boolean DEFAULT true NOT NULL,
	"sync_token" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_task_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text NOT NULL,
	"google_event_id" text NOT NULL,
	"etag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_task_links" ADD CONSTRAINT "google_task_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_task_links" ADD CONSTRAINT "google_task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_task_links_task" ON "google_task_links" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_task_links_event" ON "google_task_links" USING btree ("user_id","google_event_id");