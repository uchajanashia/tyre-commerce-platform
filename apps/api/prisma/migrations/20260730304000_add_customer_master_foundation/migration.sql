-- Phase C0: additive, empty, policy-neutral customer identity foundation.
-- There are intentionally no customer grants, seeds, references, policies, or APIs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'tyre_customer_master_owner'
  ) THEN
    CREATE ROLE tyre_customer_master_owner
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

-- A same-named pre-existing role is untrusted input. Remove every inbound and
-- outbound membership before assigning ownership: otherwise a LOGIN could
-- inherit/SET this role, or the owner could SET a more privileged role.
DO $$
DECLARE membership RECORD;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS granted_role, member.rolname AS member_role
    FROM pg_auth_members am
    JOIN pg_roles granted ON granted.oid = am.roleid
    JOIN pg_roles member ON member.oid = am.member
    WHERE granted.rolname = 'tyre_customer_master_owner'
       OR member.rolname = 'tyre_customer_master_owner'
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
  END LOOP;
END $$;

ALTER ROLE tyre_customer_master_owner
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_auth_members am
    JOIN pg_roles granted ON granted.oid = am.roleid
    JOIN pg_roles member ON member.oid = am.member
    WHERE granted.rolname = 'tyre_customer_master_owner'
       OR member.rolname = 'tyre_customer_master_owner'
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_MASTER_OWNER_MEMBERSHIP_NOT_ISOLATED';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO tyre_customer_master_owner;

CREATE TABLE "CustomerMaster" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version" BIGINT NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "CustomerMaster_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerMaster_version_positive" CHECK ("version" > 0),
  CONSTRAINT "CustomerMaster_timestamps_monotonic" CHECK ("updatedAt" >= "createdAt")
);

CREATE FUNCTION customer_master_server_fields_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  server_now TIMESTAMPTZ(6) := clock_timestamp();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."id" := gen_random_uuid();
    NEW."version" := 1;
    NEW."createdAt" := server_now;
    NEW."updatedAt" := server_now;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'CUSTOMER_MASTER_SERVER_FIELD_IMMUTABLE'
      USING ERRCODE = '22023';
  END IF;

  NEW."version" := OLD."version" + 1;
  NEW."updatedAt" := GREATEST(
    server_now,
    OLD."updatedAt" + INTERVAL '1 microsecond'
  );
  RETURN NEW;
END $$;

CREATE TRIGGER "CustomerMaster_server_fields_v1"
BEFORE INSERT OR UPDATE ON "CustomerMaster"
FOR EACH ROW EXECUTE FUNCTION customer_master_server_fields_v1();

ALTER TABLE "CustomerMaster" OWNER TO tyre_customer_master_owner;
ALTER FUNCTION customer_master_server_fields_v1()
  OWNER TO tyre_customer_master_owner;

REVOKE ALL ON TABLE "CustomerMaster" FROM PUBLIC;
REVOKE ALL ON FUNCTION customer_master_server_fields_v1() FROM PUBLIC;
