CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_key` text NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`path` text NOT NULL,
	`query_string` text DEFAULT '' NOT NULL,
	`page_title` text DEFAULT '' NOT NULL,
	`referrer` text DEFAULT '' NOT NULL,
	`ip_address` text DEFAULT '' NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`accept_language` text DEFAULT '' NOT NULL,
	`client_language` text DEFAULT '' NOT NULL,
	`client_timezone` text DEFAULT '' NOT NULL,
	`screen_width` integer,
	`screen_height` integer,
	`viewport_width` integer,
	`viewport_height` integer,
	`country` text DEFAULT '' NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`postal_code` text DEFAULT '' NOT NULL,
	`edge_timezone` text DEFAULT '' NOT NULL,
	`latitude` text DEFAULT '' NOT NULL,
	`longitude` text DEFAULT '' NOT NULL,
	`asn` integer,
	`colo` text DEFAULT '' NOT NULL,
	`http_protocol` text DEFAULT '' NOT NULL,
	`tls_version` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_events_occurred_at_idx` ON `analytics_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_visitor_key_idx` ON `analytics_events` (`visitor_key`);