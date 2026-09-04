CREATE TABLE "assessments" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40),
	"anonymous_key" varchar(64),
	"answers" text NOT NULL,
	"profile" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"date" date NOT NULL,
	"sleep_minutes" integer,
	"hrv_ms" integer,
	"resting_heart_rate" integer,
	"steps" integer,
	"water_ml" integer,
	"soreness" smallint,
	"stress" smallint,
	"readiness_score" smallint,
	"recovery_score" smallint,
	"source" varchar(32) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'not-connected' NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_profiles" (
	"user_id" varchar(40) PRIMARY KEY NOT NULL,
	"primary_goal" varchar(32) NOT NULL,
	"secondary_goals" text[] DEFAULT '{}'::text[] NOT NULL,
	"age_range" varchar(10) NOT NULL,
	"experience" varchar(16) NOT NULL,
	"days_per_week" smallint NOT NULL,
	"session_minutes" smallint NOT NULL,
	"training_location" varchar(16) NOT NULL,
	"equipment" text[] DEFAULT '{}'::text[] NOT NULL,
	"diet" varchar(24) NOT NULL,
	"coaching_preference" varchar(24) NOT NULL,
	"height_cm" integer,
	"weight_kg" integer,
	"sex_at_birth" varchar(24),
	"baseline_sleep_minutes" integer DEFAULT 450 NOT NULL,
	"baseline_hrv_ms" integer DEFAULT 62 NOT NULL,
	"baseline_resting_heart_rate" integer DEFAULT 58 NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"href" varchar(255),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" varchar(80) NOT NULL,
	"last_name" varchar(80) NOT NULL,
	"role" varchar(16) DEFAULT 'member' NOT NULL,
	"avatar_key" varchar(120),
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"unit_system" varchar(10) DEFAULT 'metric' NOT NULL,
	"locale" varchar(10) DEFAULT 'en-GB' NOT NULL,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"date" date NOT NULL,
	"weight_grams" integer,
	"body_fat_percent" smallint,
	"waist_mm" integer,
	"chest_mm" integer,
	"hips_mm" integer,
	"arm_mm" integer,
	"thigh_mm" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"title" varchar(160) NOT NULL,
	"date" date NOT NULL,
	"start_minutes" smallint NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"reference_id" varchar(40),
	"status" varchar(16) DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_loads" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"exercise_id" varchar(64) NOT NULL,
	"working_load_grams" integer NOT NULL,
	"last_reps" smallint,
	"last_rpe" smallint,
	"best_load_grams" integer DEFAULT 0 NOT NULL,
	"best_estimated_one_rep_max" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_records" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"exercise_id" varchar(64) NOT NULL,
	"exercise_name" varchar(120) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"value_grams" integer NOT NULL,
	"previous_value_grams" integer DEFAULT 0 NOT NULL,
	"reps" smallint DEFAULT 1 NOT NULL,
	"achieved_on" date NOT NULL,
	"workout_log_id" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_days" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"plan_week_id" varchar(40) NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"date" date NOT NULL,
	"day_of_week" smallint NOT NULL,
	"kind" varchar(16) NOT NULL,
	"title" varchar(120) NOT NULL,
	"focus" varchar(120) NOT NULL,
	"minutes" smallint NOT NULL,
	"patterns" text[] DEFAULT '{}'::text[] NOT NULL,
	"session_template" text,
	"status" varchar(16) DEFAULT 'scheduled' NOT NULL,
	"rescheduled_from" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_weeks" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"plan_id" varchar(40) NOT NULL,
	"week_number" smallint NOT NULL,
	"phase" varchar(16) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"deload" boolean DEFAULT false NOT NULL,
	"nutrition_goal" varchar(160) NOT NULL,
	"recovery_target" varchar(160) NOT NULL,
	"coach_check_in" boolean DEFAULT false NOT NULL,
	"milestone" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"program_slug" varchar(64) NOT NULL,
	"program_name" varchar(120) NOT NULL,
	"goal" varchar(32) NOT NULL,
	"start_date" date NOT NULL,
	"total_weeks" smallint NOT NULL,
	"sessions_per_week" smallint NOT NULL,
	"session_minutes" smallint NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"phases" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_logs" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"recovery_session_id" varchar(40),
	"date" date NOT NULL,
	"minutes" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_sessions" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"category" varchar(32) NOT NULL,
	"minutes" smallint NOT NULL,
	"level" varchar(16) DEFAULT 'beginner' NOT NULL,
	"description" text NOT NULL,
	"coach_slug" varchar(64),
	"image_key" varchar(64) NOT NULL,
	"has_captions" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_sessions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "set_logs" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workout_log_id" varchar(40) NOT NULL,
	"exercise_id" varchar(64) NOT NULL,
	"exercise_name" varchar(120) NOT NULL,
	"set_index" smallint NOT NULL,
	"reps" smallint DEFAULT 0 NOT NULL,
	"load_grams" integer DEFAULT 0 NOT NULL,
	"rpe" smallint,
	"completed" boolean DEFAULT false NOT NULL,
	"rest_seconds" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_logs" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"plan_day_id" varchar(40),
	"title" varchar(120) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"date" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"volume_grams" integer DEFAULT 0 NOT NULL,
	"calories" integer DEFAULT 0 NOT NULL,
	"average_heart_rate" smallint,
	"max_heart_rate" smallint,
	"average_rpe" smallint,
	"session_load" integer DEFAULT 0 NOT NULL,
	"difficulty_feedback" varchar(16),
	"muscle_groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_logs" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"date" date NOT NULL,
	"slot" varchar(16) NOT NULL,
	"name" varchar(140) NOT NULL,
	"recipe_id" varchar(40),
	"calories" integer NOT NULL,
	"protein_grams" smallint NOT NULL,
	"carb_grams" smallint NOT NULL,
	"fat_grams" smallint NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plan_entries" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"date" date NOT NULL,
	"slot" varchar(16) NOT NULL,
	"recipe_id" varchar(40) NOT NULL,
	"status" varchar(16) DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition_targets" (
	"user_id" varchar(40) PRIMARY KEY NOT NULL,
	"calories" integer NOT NULL,
	"protein_grams" smallint NOT NULL,
	"carb_grams" smallint NOT NULL,
	"fat_grams" smallint NOT NULL,
	"fibre_grams" smallint NOT NULL,
	"water_ml" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_favourites" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"recipe_id" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"recipe_id" varchar(40) NOT NULL,
	"name" varchar(120) NOT NULL,
	"quantity_centi" integer NOT NULL,
	"unit" varchar(24) NOT NULL,
	"section" varchar(16) NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(140) NOT NULL,
	"summary" text NOT NULL,
	"slot" varchar(16) NOT NULL,
	"calories" integer NOT NULL,
	"protein_grams" smallint NOT NULL,
	"carb_grams" smallint NOT NULL,
	"fat_grams" smallint NOT NULL,
	"fibre_grams" smallint DEFAULT 0 NOT NULL,
	"prep_minutes" smallint NOT NULL,
	"cook_minutes" smallint DEFAULT 0 NOT NULL,
	"difficulty" varchar(16) DEFAULT 'easy' NOT NULL,
	"servings" smallint DEFAULT 1 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"instructions" text[] DEFAULT '{}'::text[] NOT NULL,
	"image_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "shopping_list_items" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"week_start" date NOT NULL,
	"name" varchar(120) NOT NULL,
	"quantity_centi" integer NOT NULL,
	"unit" varchar(24) NOT NULL,
	"section" varchar(16) NOT NULL,
	"recipe_count" smallint DEFAULT 1 NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"question" text NOT NULL,
	"intent" varchar(32) NOT NULL,
	"answer" text NOT NULL,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"coach_id" varchar(40) NOT NULL,
	"member_id" varchar(40) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"status" varchar(16) DEFAULT 'confirmed' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"agenda" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"member_id" varchar(40) NOT NULL,
	"coach_id" varchar(40),
	"week_start" date NOT NULL,
	"energy" smallint NOT NULL,
	"sleep_quality" smallint NOT NULL,
	"stress" smallint NOT NULL,
	"nutrition_adherence" smallint NOT NULL,
	"training_adherence" smallint NOT NULL,
	"weight_grams" integer,
	"pain_notes" text,
	"questions" text,
	"progress_photo_count" smallint DEFAULT 0 NOT NULL,
	"score" smallint NOT NULL,
	"band" varchar(16) NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"coach_response" text,
	"responded_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_applications" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"email" varchar(320) NOT NULL,
	"certifications" text NOT NULL,
	"years_experience" smallint NOT NULL,
	"specialties" text[] DEFAULT '{}'::text[] NOT NULL,
	"about" text NOT NULL,
	"status" varchar(16) DEFAULT 'submitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_clients" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"coach_id" varchar(40) NOT NULL,
	"member_id" varchar(40) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_notes" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"coach_id" varchar(40) NOT NULL,
	"member_id" varchar(40) NOT NULL,
	"body" text NOT NULL,
	"visibility" varchar(16) DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_reviews" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"coach_id" varchar(40) NOT NULL,
	"member_id" varchar(40) NOT NULL,
	"rating" smallint NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaches" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"headline" varchar(140) NOT NULL,
	"bio" text NOT NULL,
	"philosophy" text NOT NULL,
	"specialties" text[] DEFAULT '{}'::text[] NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"certifications" text[] DEFAULT '{}'::text[] NOT NULL,
	"years_experience" smallint NOT NULL,
	"rating_tenths" smallint DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"client_count" integer DEFAULT 0 NOT NULL,
	"client_cap" smallint DEFAULT 40 NOT NULL,
	"available_slots_this_week" smallint DEFAULT 0 NOT NULL,
	"accepting_clients" boolean DEFAULT true NOT NULL,
	"monthly_price_cents" integer NOT NULL,
	"consultation_price_cents" integer NOT NULL,
	"session_price_cents" integer NOT NULL,
	"image_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coaches_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "form_check_comments" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"message_id" varchar(40) NOT NULL,
	"author_id" varchar(40) NOT NULL,
	"timestamp_seconds" smallint NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"member_id" varchar(40) NOT NULL,
	"coach_id" varchar(40) NOT NULL,
	"subject" varchar(160) DEFAULT 'Coaching' NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"thread_id" varchar(40) NOT NULL,
	"sender_id" varchar(40) NOT NULL,
	"kind" varchar(16) DEFAULT 'text' NOT NULL,
	"body" text,
	"media_key" varchar(120),
	"duration_seconds" smallint,
	"exercise_id" varchar(64),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"slug" varchar(100) NOT NULL,
	"title" varchar(200) NOT NULL,
	"category" varchar(32) NOT NULL,
	"excerpt" text NOT NULL,
	"body" text NOT NULL,
	"author_name" varchar(120) NOT NULL,
	"author_role" varchar(120) NOT NULL,
	"read_minutes" smallint NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"image_key" varchar(64) NOT NULL,
	"published_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "challenge_participants" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"challenge_slug" varchar(64) NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"started_on" date NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"follower_id" varchar(40) NOT NULL,
	"followee_id" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"slug" varchar(48) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"image_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "post_comments" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"post_id" varchar(40) NOT NULL,
	"author_id" varchar(40) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_likes" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"post_id" varchar(40) NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_saves" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"post_id" varchar(40) NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"author_id" varchar(40) NOT NULL,
	"group_slug" varchar(48),
	"kind" varchar(24) DEFAULT 'update' NOT NULL,
	"body" text NOT NULL,
	"media_key" varchar(120),
	"workout_log_id" varchar(40),
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "success_stories" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"slug" varchar(100) NOT NULL,
	"member_name" varchar(80) NOT NULL,
	"headline" varchar(200) NOT NULL,
	"starting_goal" varchar(140) NOT NULL,
	"program_slug" varchar(64) NOT NULL,
	"program_name" varchar(120) NOT NULL,
	"time_period" varchar(60) NOT NULL,
	"consistency" varchar(60) NOT NULL,
	"coach_slug" varchar(64),
	"story" text NOT NULL,
	"outcomes" text[] DEFAULT '{}'::text[] NOT NULL,
	"image_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "success_stories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"product_id" varchar(40) NOT NULL,
	"quantity" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"subscription_id" varchar(40),
	"description" varchar(200) NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" varchar(16) DEFAULT 'paid' NOT NULL,
	"issued_on" date NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"order_id" varchar(40) NOT NULL,
	"product_id" varchar(40) NOT NULL,
	"name" varchar(140) NOT NULL,
	"quantity" smallint NOT NULL,
	"unit_price_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"status" varchar(16) DEFAULT 'confirmed' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"brand" varchar(24),
	"last4" varchar(4),
	"expiry_month" smallint,
	"expiry_year" smallint,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_reviews" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"product_id" varchar(40) NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"rating" smallint NOT NULL,
	"title" varchar(140) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(140) NOT NULL,
	"category" varchar(40) NOT NULL,
	"summary" text NOT NULL,
	"description" text NOT NULL,
	"price_cents" integer NOT NULL,
	"compare_at_cents" integer,
	"financing_months" smallint DEFAULT 0 NOT NULL,
	"rating_tenths" smallint DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"specs" text DEFAULT '{}' NOT NULL,
	"compatible_programs" text[] DEFAULT '{}'::text[] NOT NULL,
	"goals" text[] DEFAULT '{}'::text[] NOT NULL,
	"warranty" varchar(120) NOT NULL,
	"shipping" varchar(160) NOT NULL,
	"in_stock" boolean DEFAULT true NOT NULL,
	"image_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"tier" varchar(24) NOT NULL,
	"billing_interval" varchar(12) DEFAULT 'monthly' NOT NULL,
	"status" varchar(16) DEFAULT 'trialing' NOT NULL,
	"price_cents" integer NOT NULL,
	"promo_code" varchar(32),
	"trial_ends_on" date,
	"current_period_ends_on" date NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_loads" ADD CONSTRAINT "exercise_loads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_plan_week_id_plan_weeks_id_fk" FOREIGN KEY ("plan_week_id") REFERENCES "public"."plan_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_weeks" ADD CONSTRAINT "plan_weeks_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_logs" ADD CONSTRAINT "recovery_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_logs" ADD CONSTRAINT "recovery_logs_recovery_session_id_recovery_sessions_id_fk" FOREIGN KEY ("recovery_session_id") REFERENCES "public"."recovery_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_plan_day_id_plan_days_id_fk" FOREIGN KEY ("plan_day_id") REFERENCES "public"."plan_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_favourites" ADD CONSTRAINT "recipe_favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_favourites" ADD CONSTRAINT "recipe_favourites_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_clients" ADD CONSTRAINT "coach_clients_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_clients" ADD CONSTRAINT "coach_clients_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_reviews" ADD CONSTRAINT "coach_reviews_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_reviews" ADD CONSTRAINT "coach_reviews_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaches" ADD CONSTRAINT "coaches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_check_comments" ADD CONSTRAINT "form_check_comments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_check_comments" ADD CONSTRAINT "form_check_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_saves" ADD CONSTRAINT "post_saves_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_saves" ADD CONSTRAINT "post_saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_group_slug_groups_slug_fk" FOREIGN KEY ("group_slug") REFERENCES "public"."groups"("slug") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessments_user_idx" ON "assessments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_unique" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_metrics_user_date_unique" ON "daily_metrics" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_user_provider_unique" ON "devices" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "body_measurements_user_date_unique" ON "body_measurements" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "calendar_events_user_date_idx" ON "calendar_events" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_loads_user_exercise_unique" ON "exercise_loads" USING btree ("user_id","exercise_id");--> statement-breakpoint
CREATE INDEX "personal_records_user_exercise_idx" ON "personal_records" USING btree ("user_id","exercise_id");--> statement-breakpoint
CREATE INDEX "plan_days_user_date_idx" ON "plan_days" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "plan_days_week_idx" ON "plan_days" USING btree ("plan_week_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_weeks_plan_week_unique" ON "plan_weeks" USING btree ("plan_id","week_number");--> statement-breakpoint
CREATE INDEX "plans_user_status_idx" ON "plans" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "recovery_logs_user_date_idx" ON "recovery_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "set_logs_workout_exercise_set_unique" ON "set_logs" USING btree ("workout_log_id","exercise_id","set_index");--> statement-breakpoint
CREATE INDEX "set_logs_exercise_idx" ON "set_logs" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "workout_logs_user_date_idx" ON "workout_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "meal_logs_user_date_idx" ON "meal_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plan_user_date_slot_unique" ON "meal_plan_entries" USING btree ("user_id","date","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_favourites_unique" ON "recipe_favourites" USING btree ("user_id","recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_recipe_idx" ON "recipe_ingredients" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipes_slot_idx" ON "recipes" USING btree ("slot");--> statement-breakpoint
CREATE INDEX "shopping_list_user_week_idx" ON "shopping_list_items" USING btree ("user_id","week_start");--> statement-breakpoint
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_coach_start_idx" ON "bookings" USING btree ("coach_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_member_week_unique" ON "check_ins" USING btree ("member_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_clients_unique" ON "coach_clients" USING btree ("coach_id","member_id");--> statement-breakpoint
CREATE INDEX "coach_notes_coach_member_idx" ON "coach_notes" USING btree ("coach_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_reviews_unique" ON "coach_reviews" USING btree ("coach_id","member_id");--> statement-breakpoint
CREATE INDEX "coaches_accepting_idx" ON "coaches" USING btree ("accepting_clients");--> statement-breakpoint
CREATE INDEX "form_check_comments_message_idx" ON "form_check_comments" USING btree ("message_id","timestamp_seconds");--> statement-breakpoint
CREATE UNIQUE INDEX "message_threads_unique" ON "message_threads" USING btree ("member_id","coach_id");--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "articles_category_idx" ON "articles" USING btree ("category","published_on");--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_participants_unique" ON "challenge_participants" USING btree ("challenge_slug","user_id");--> statement-breakpoint
CREATE INDEX "challenge_participants_board_idx" ON "challenge_participants" USING btree ("challenge_slug","value");--> statement-breakpoint
CREATE UNIQUE INDEX "follows_unique" ON "follows" USING btree ("follower_id","followee_id");--> statement-breakpoint
CREATE INDEX "post_comments_post_idx" ON "post_comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_likes_unique" ON "post_likes" USING btree ("post_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_saves_unique" ON "post_saves" USING btree ("post_id","user_id");--> statement-breakpoint
CREATE INDEX "posts_group_created_idx" ON "posts" USING btree ("group_slug","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_unique" ON "cart_items" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "invoices_user_issued_idx" ON "invoices" USING btree ("user_id","issued_on");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id","placed_at");--> statement-breakpoint
CREATE INDEX "payment_methods_user_idx" ON "payment_methods" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_reviews_unique" ON "product_reviews" USING btree ("product_id","user_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" USING btree ("user_id","status");