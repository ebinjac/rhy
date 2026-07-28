ALTER TABLE elf_settings
    ADD COLUMN IF NOT EXISTS encrypted_credential TEXT NOT NULL DEFAULT '';
