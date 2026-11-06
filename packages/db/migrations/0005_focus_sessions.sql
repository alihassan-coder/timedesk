CREATE TABLE "focus_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"focused_seconds" integer NOT NULL,
	"distracted_seconds" integer NOT NULL,
	"away_seconds" integer DEFAULT 0 NOT NULL,
	"interruptions" integer DEFAULT 0 NOT NULL,
	"distractions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "focus_user_started_idx" ON "focus_sessions" USING btree ("user_id","started_at");