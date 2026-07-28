CREATE TABLE `analytics_daily_visitors` (
	`day` text NOT NULL,
	`visitor_key` text NOT NULL,
	PRIMARY KEY(`day`, `visitor_key`)
);
--> statement-breakpoint
CREATE TABLE `analytics_visitors` (
	`visitor_key` text PRIMARY KEY NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_metrics` (
	`day` text PRIMARY KEY NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`unique_visitors` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_metrics` (
	`id` integer PRIMARY KEY NOT NULL,
	`total_views` integer DEFAULT 0 NOT NULL,
	`total_visitors` integer DEFAULT 0 NOT NULL
);
