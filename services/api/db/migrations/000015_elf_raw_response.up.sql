ALTER TABLE elf_runs
    ADD COLUMN raw_response JSONB NOT NULL DEFAULT '{}'::jsonb;
