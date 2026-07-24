DROP INDEX IF EXISTS applications_car_id_unique;

ALTER TABLE applications
    DROP COLUMN IF EXISTS car_id;

