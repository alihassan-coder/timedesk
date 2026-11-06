CREATE TABLE "weekly_reviews" (
	"user_id" text NOT NULL,
	"week_start" text NOT NULL,
	"went_well" text DEFAULT '' NOT NULL,
	"improve" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_reviews_user_id_week_start_pk" PRIMARY KEY("user_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Tasks finished before this column existed: their last change is the best guess of when.
UPDATE "tasks" SET "completed_at" = "updated_at" WHERE "status" = 'done' AND "completed_at" IS NULL;
