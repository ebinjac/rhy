DROP TABLE IF EXISTS elf_runs;
ALTER TABLE elf_queries DROP CONSTRAINT IF EXISTS elf_queries_current_revision_fk;
DROP TABLE IF EXISTS elf_query_revisions;
DROP TABLE IF EXISTS elf_queries;
DROP TABLE IF EXISTS application_monitor_links;
DROP TABLE IF EXISTS application_services;
DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS elf_settings;
