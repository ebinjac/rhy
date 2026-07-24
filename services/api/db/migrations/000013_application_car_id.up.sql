ALTER TABLE applications
    ADD COLUMN car_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX applications_car_id_unique
    ON applications (LOWER(car_id))
    WHERE car_id <> '';

