DROP TABLE IF EXISTS `analytics_events`;
--> statement-breakpoint
DROP TABLE IF EXISTS `analytics_visitors`;
--> statement-breakpoint
DROP TABLE IF EXISTS `analytics_daily_visitors`;
--> statement-breakpoint
DROP TABLE IF EXISTS `daily_metrics`;
--> statement-breakpoint
DROP TABLE IF EXISTS `site_metrics`;
--> statement-breakpoint
CREATE TABLE `analytics_daily_metrics` (
	`day` text PRIMARY KEY NOT NULL,
	`page_views` integer DEFAULT 0 NOT NULL,
	`unique_visitors` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_daily_visitors` (
	`day` text NOT NULL,
	`visitor_id` text NOT NULL,
	PRIMARY KEY(`day`, `visitor_id`)
);
--> statement-breakpoint
CREATE TABLE `analytics_fingerprint_aliases` (
	`fingerprint_hash` text PRIMARY KEY NOT NULL,
	`visitor_id` text NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_rate_limits` (
	`bucket` text NOT NULL,
	`limiter_key` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`bucket`, `limiter_key`)
);
--> statement-breakpoint
CREATE TABLE `analytics_visitors` (
	`visitor_id` text PRIMARY KEY NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
