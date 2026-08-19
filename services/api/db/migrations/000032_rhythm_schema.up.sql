CREATE SCHEMA IF NOT EXISTS rhythm;

DO $migration$
DECLARE item record;
BEGIN
    FOR item IN
        SELECT c.relname, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m')
          AND c.relname NOT IN ('databasechangelog','databasechangeloglock')
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'
          )
    LOOP
        EXECUTE format(
            CASE item.relkind WHEN 'S' THEN 'ALTER SEQUENCE public.%I SET SCHEMA rhythm'
            WHEN 'v' THEN 'ALTER VIEW public.%I SET SCHEMA rhythm'
            WHEN 'm' THEN 'ALTER MATERIALIZED VIEW public.%I SET SCHEMA rhythm'
            ELSE 'ALTER TABLE public.%I SET SCHEMA rhythm' END,
            item.relname
        );
    END LOOP;
END $migration$;
