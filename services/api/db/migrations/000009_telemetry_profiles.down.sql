ALTER TABLE configuration_profiles DROP CONSTRAINT configuration_profiles_kind_check;
ALTER TABLE configuration_profiles ADD CONSTRAINT configuration_profiles_kind_check CHECK (kind IN ('ENVIRONMENT','SECRET_REFERENCE','CERTIFICATE','PROXY','AUTH','NOTIFICATION'));
