CREATE TABLE "activity_samples" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"app" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"seconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_samples" ADD CONSTRAINT "activity_samples_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_user_started_idx" ON "activity_samples" USING btree ("user_id","started_at");