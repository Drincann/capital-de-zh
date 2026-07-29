CREATE TABLE `reader_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`version_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`quote` text NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`suffix` text DEFAULT '' NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`color` text DEFAULT 'amber' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reader_notes_section_idx` ON `reader_notes` (`section_id`);