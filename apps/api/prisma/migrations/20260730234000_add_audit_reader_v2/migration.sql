-- Increment 3B: additive, immutable AuditEventV2 registry/projection and the
-- single current-authorization relation used by list/detail/continuation.
ALTER TABLE "SecurityControl" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Role" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "AuditEventSchemaV2" (
  "eventType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "ownerDomain" TEXT NOT NULL,
  "actorTypes" TEXT[] NOT NULL,
  "subjectTypes" TEXT[] NOT NULL,
  "actions" TEXT[] NOT NULL,
  "entityTypes" TEXT[] NOT NULL,
  "outcomes" TEXT[] NOT NULL,
  "sources" TEXT[] NOT NULL,
  "registryDigestVersion" INTEGER NOT NULL DEFAULT 1,
  "registryDigest" TEXT NOT NULL,
  "authorizationScopeKind" TEXT NOT NULL,
  "scopeMatchMode" TEXT NOT NULL,
  "requiredGlobalGrant" TEXT,
  "allowGlobalReader" BOOLEAN NOT NULL DEFAULT false,
  "allowedScopeDimensions" TEXT[] NOT NULL,
  "scopeResolverId" TEXT NOT NULL,
  "scopeResolverVersion" INTEGER NOT NULL,
  "authorizationPolicyVersion" INTEGER NOT NULL,
  "retentionClass" TEXT NOT NULL,
  "fieldSchema" JSONB NOT NULL,
  "maxProjectionBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEventSchemaV2_pkey" PRIMARY KEY ("eventType", "schemaVersion"),
  CONSTRAINT "AuditEventSchemaV2_eventType_schemaVersion_registryDigest_key" UNIQUE ("eventType", "schemaVersion", "registryDigest"),
  CONSTRAINT "AuditEventSchemaV2_versions_check" CHECK (
    "schemaVersion" > 0 AND "registryDigestVersion" = 1 AND
    "scopeResolverVersion" > 0 AND "authorizationPolicyVersion" > 0 AND
    "maxProjectionBytes" > 0
  ),
  CONSTRAINT "AuditEventSchemaV2_envelope_arrays_check" CHECK (
    cardinality("actorTypes") > 0 AND cardinality("subjectTypes") > 0 AND cardinality("actions") > 0 AND
    cardinality("entityTypes") > 0 AND cardinality("outcomes") > 0 AND cardinality("sources") > 0 AND
    "outcomes" <@ ARRAY['succeeded','failed','denied']::TEXT[] AND
    "sources" <@ ARRAY['admin_api','job','webhook','import','system']::TEXT[]
  ),
  CONSTRAINT "AuditEventSchemaV2_kind_check" CHECK (
    "authorizationScopeKind" IN ('resource_scoped', 'global_security', 'cross_scope', 'legacy_restricted')
  ),
  CONSTRAINT "AuditEventSchemaV2_mode_check" CHECK ("scopeMatchMode" IN ('all', 'any')),
  CONSTRAINT "AuditEventSchemaV2_scope_contract_check" CHECK (
    ("authorizationScopeKind" = 'global_security' AND "scopeMatchMode" = 'all' AND
      "requiredGlobalGrant" IS NOT NULL AND cardinality("allowedScopeDimensions") = 0 AND NOT "allowGlobalReader")
    OR
    ("authorizationScopeKind" = 'resource_scoped' AND
      "requiredGlobalGrant" IS NULL AND cardinality("allowedScopeDimensions") > 0)
    OR
    ("authorizationScopeKind" = 'cross_scope' AND "scopeMatchMode" = 'all' AND
      cardinality("allowedScopeDimensions") > 0 AND NOT "allowGlobalReader")
    OR
    ("authorizationScopeKind" = 'legacy_restricted' AND "scopeMatchMode" = 'all' AND
      "requiredGlobalGrant" IS NULL AND cardinality("allowedScopeDimensions") = 0 AND NOT "allowGlobalReader")
  ),
  CONSTRAINT "AuditEventSchemaV2_dimensions_check" CHECK (
    "allowedScopeDimensions" <@ ARRAY['warehouse','channel','company']::TEXT[]
  ),
  CONSTRAINT "AuditEventSchemaV2_field_schema_check" CHECK (jsonb_typeof("fieldSchema") = 'object')
);

CREATE TABLE "AuditEventV2" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "registryDigestVersion" INTEGER NOT NULL DEFAULT 1,
  "registryDigest" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "sessionId" TEXT,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "entityVersion" TEXT,
  "authorizationScopeKind" TEXT NOT NULL,
  "scopeMatchMode" TEXT NOT NULL,
  "requiredGlobalGrant" TEXT,
  "scopeResolverId" TEXT NOT NULL,
  "scopeResolverVersion" INTEGER NOT NULL,
  "authorizationPolicyVersion" INTEGER NOT NULL,
  "resourceOwnerSnapshot" JSONB,
  "outcome" TEXT NOT NULL,
  "reasonCode" TEXT,
  "safeBefore" JSONB,
  "safeAfter" JSONB,
  "safeMetadata" JSONB,
  "approvalRequestId" TEXT,
  "approvalExecutionId" TEXT,
  "bulkOperationId" TEXT,
  "bulkItemId" TEXT,
  "serverCorrelationId" TEXT NOT NULL,
  "causationId" TEXT,
  "clientRequestId" TEXT,
  "source" TEXT NOT NULL,
  "retentionClass" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEventV2_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditEventV2_eventType_schemaVersion_registryDigest_fkey" FOREIGN KEY ("eventType", "schemaVersion", "registryDigest")
    REFERENCES "AuditEventSchemaV2"("eventType", "schemaVersion", "registryDigest") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AuditEventV2_versions_check" CHECK (
    "schemaVersion" > 0 AND "registryDigestVersion" = 1 AND
    "scopeResolverVersion" > 0 AND "authorizationPolicyVersion" > 0
  ),
  CONSTRAINT "AuditEventV2_kind_check" CHECK (
    "authorizationScopeKind" IN ('resource_scoped', 'global_security', 'cross_scope', 'legacy_restricted')
  ),
  CONSTRAINT "AuditEventV2_mode_check" CHECK ("scopeMatchMode" IN ('all', 'any')),
  CONSTRAINT "AuditEventV2_outcome_check" CHECK ("outcome" IN ('succeeded', 'failed', 'denied')),
  CONSTRAINT "AuditEventV2_source_check" CHECK ("source" IN ('admin_api', 'job', 'webhook', 'import', 'system')),
  CONSTRAINT "AuditEventV2_safe_before_check" CHECK ("safeBefore" IS NULL OR jsonb_typeof("safeBefore") = 'array'),
  CONSTRAINT "AuditEventV2_safe_after_check" CHECK ("safeAfter" IS NULL OR jsonb_typeof("safeAfter") = 'array'),
  CONSTRAINT "AuditEventV2_safe_metadata_check" CHECK ("safeMetadata" IS NULL OR jsonb_typeof("safeMetadata") = 'array'),
  CONSTRAINT "AuditEventV2_client_request_check" CHECK ("clientRequestId" IS NULL OR octet_length("clientRequestId") <= 128),
  CONSTRAINT "AuditEventV2_correlation_check" CHECK (
    octet_length("serverCorrelationId") BETWEEN 1 AND 128 AND
    ("causationId" IS NULL OR octet_length("causationId") BETWEEN 1 AND 128)
  )
);

CREATE TABLE "AuditEventScopeRefV2" (
  "eventId" TEXT NOT NULL,
  "dimension" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  CONSTRAINT "AuditEventScopeRefV2_pkey" PRIMARY KEY ("eventId", "dimension", "scopeId"),
  CONSTRAINT "AuditEventScopeRefV2_eventId_ordinal_key" UNIQUE ("eventId", "ordinal"),
  CONSTRAINT "AuditEventScopeRefV2_eventId_fkey" FOREIGN KEY ("eventId")
    REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AuditEventScopeRefV2_dimension_check" CHECK ("dimension" IN ('warehouse', 'channel', 'company')),
  CONSTRAINT "AuditEventScopeRefV2_scope_id_check" CHECK (
    octet_length("scopeId") BETWEEN 1 AND 128 AND "scopeId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CONSTRAINT "AuditEventScopeRefV2_ordinal_check" CHECK ("ordinal" >= 0)
);

CREATE INDEX "AuditEventV2_occurredAt_id_idx" ON "AuditEventV2"("occurredAt", "id");
CREATE INDEX "AuditEventV2_eventType_occurredAt_id_idx" ON "AuditEventV2"("eventType", "occurredAt", "id");
CREATE INDEX "AuditEventV2_outcome_occurredAt_id_idx" ON "AuditEventV2"("outcome", "occurredAt", "id");
CREATE INDEX "AuditEventV2_actorId_occurredAt_id_idx" ON "AuditEventV2"("actorId", "occurredAt", "id");
CREATE INDEX "AuditEventV2_entityType_entityId_occurredAt_id_idx" ON "AuditEventV2"("entityType", "entityId", "occurredAt", "id");
CREATE INDEX "AuditEventV2_approvalRequestId_occurredAt_id_idx" ON "AuditEventV2"("approvalRequestId", "occurredAt", "id");
CREATE INDEX "AuditEventV2_approvalExecutionId_occurredAt_id_idx" ON "AuditEventV2"("approvalExecutionId", "occurredAt", "id");
CREATE INDEX "AuditEventV2_bulkOperationId_bulkItemId_occurredAt_id_idx" ON "AuditEventV2"("bulkOperationId", "bulkItemId", "occurredAt", "id");
CREATE INDEX "AuditEventV2_serverCorrelationId_occurredAt_id_idx" ON "AuditEventV2"("serverCorrelationId", "occurredAt", "id");
CREATE INDEX "AuditEventV2_causationId_occurredAt_id_idx" ON "AuditEventV2"("causationId", "occurredAt", "id");
CREATE INDEX "AuditEventV2_source_occurredAt_id_idx" ON "AuditEventV2"("source", "occurredAt", "id");
CREATE INDEX "AuditEventV2_retentionClass_occurredAt_id_idx" ON "AuditEventV2"("retentionClass", "occurredAt", "id");
CREATE INDEX "AuditEventScopeRefV2_dimension_scopeId_eventId_idx" ON "AuditEventScopeRefV2"("dimension", "scopeId", "eventId");

-- One technical, non-PII schema is activated so cursor failures can be safely
-- recorded. Domain schemas remain unavailable until owner-approved scope and
-- masking definitions exist.
INSERT INTO "AuditEventSchemaV2" (
  "eventType", "schemaVersion", "ownerDomain", "actorTypes", "subjectTypes", "actions", "entityTypes", "outcomes", "sources",
  "registryDigestVersion", "registryDigest",
  "authorizationScopeKind", "scopeMatchMode", "requiredGlobalGrant", "allowGlobalReader",
  "allowedScopeDimensions", "scopeResolverId", "scopeResolverVersion",
  "authorizationPolicyVersion", "retentionClass", "fieldSchema", "maxProjectionBytes"
) VALUES (
  'audit.reader.cursor_rejected', 1, 'audit', ARRAY['staff'], ARRAY['audit_reader'],
  ARRAY['audit.reader.cursor.validate'], ARRAY['AuditCursor'], ARRAY['denied'], ARRAY['admin_api'], 1,
  'l-jcdhxxJW2iyRwvMiNTO2p-uEFoPqJJm3F2g-bbciM',
  'global_security', 'all', 'audit.read_security', false, ARRAY[]::TEXT[],
  'audit-reader-security-v1', 1, 1, 'security_control',
  '{"before":{},"after":{},"metadata":{"code":{"type":"string","classification":"public_operational","label":"Validation code","maxBytes":64},"keyId":{"type":"string","classification":"masked","label":"Cursor key","maxBytes":64}}}'::jsonb,
  512
);

CREATE OR REPLACE FUNCTION reject_audit_v2_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEventSchemaV2_append_only"
BEFORE UPDATE OR DELETE ON "AuditEventSchemaV2"
FOR EACH ROW EXECUTE FUNCTION reject_audit_v2_mutation();
CREATE TRIGGER "AuditEventV2_append_only"
BEFORE UPDATE OR DELETE ON "AuditEventV2"
FOR EACH ROW EXECUTE FUNCTION reject_audit_v2_mutation();
CREATE TRIGGER "AuditEventScopeRefV2_append_only"
BEFORE UPDATE OR DELETE ON "AuditEventScopeRefV2"
FOR EACH ROW EXECUTE FUNCTION reject_audit_v2_mutation();

CREATE OR REPLACE FUNCTION audit_v2_safe_text(value TEXT, max_bytes INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN value IS NOT NULL AND max_bytes > 0 AND octet_length(value) <= max_bytes
    AND value !~ '[[:cntrl:]]'
    AND position(U&'\200B' IN value) = 0 AND position(U&'\200C' IN value) = 0
    AND position(U&'\200D' IN value) = 0 AND position(U&'\200E' IN value) = 0
    AND position(U&'\200F' IN value) = 0 AND position(U&'\202A' IN value) = 0
    AND position(U&'\202B' IN value) = 0 AND position(U&'\202C' IN value) = 0
    AND position(U&'\202D' IN value) = 0 AND position(U&'\202E' IN value) = 0
    AND position(U&'\2060' IN value) = 0 AND position(U&'\2066' IN value) = 0
    AND position(U&'\2067' IN value) = 0 AND position(U&'\2068' IN value) = 0
    AND position(U&'\2069' IN value) = 0 AND position(U&'\FEFF' IN value) = 0;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION audit_v2_projection_is_valid(payload JSONB, definitions JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  item JSONB;
  definition JSONB;
  field_key TEXT;
  value_kind TEXT;
  seen_keys TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF payload IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(payload) <> 'array' OR jsonb_typeof(definitions) <> 'object' THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(payload)
  LOOP
    IF jsonb_typeof(item) <> 'object' OR
       (SELECT count(*) FROM jsonb_object_keys(item)) <> 4 OR
       NOT (item ?& ARRAY['key','label','classification','value']) THEN RETURN false; END IF;
    field_key := item->>'key';
    IF field_key IS NULL OR field_key = ANY(seen_keys) OR field_key !~ '^[a-z][A-Za-z0-9_.-]{0,127}$'
       OR field_key ~* '(password|authorization|cookie|secret|token|totp|recovery|ciphertext|auth.?tag|nonce|credential|request.?body|attachment)' THEN
      RETURN false;
    END IF;
    seen_keys := array_append(seen_keys, field_key);
    definition := definitions->field_key;
    IF definition IS NULL OR item->>'label' IS DISTINCT FROM definition->>'label'
       OR item->>'classification' IS DISTINCT FROM definition->>'classification'
       OR definition->>'classification' NOT IN ('public_operational','masked')
       OR NOT audit_v2_safe_text(item->>'label', 128) THEN RETURN false; END IF;
    value_kind := jsonb_typeof(item->'value');
    IF definition->>'classification' = 'masked' THEN
      IF item->>'value' <> '[masked]' THEN RETURN false; END IF;
    ELSIF value_kind <> 'null' AND value_kind IS DISTINCT FROM definition->>'type' THEN
      RETURN false;
    END IF;
    IF value_kind = 'string' AND NOT audit_v2_safe_text(item->>'value',
      CASE WHEN definition->>'classification' = 'masked' THEN 16 ELSE (definition->>'maxBytes')::INTEGER END) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION validate_audit_registry_v2_insert()
RETURNS trigger AS $$
DECLARE
  section_name TEXT;
  field_key TEXT;
  definition JSONB;
  values_array TEXT[];
BEGIN
  IF NOT audit_v2_safe_text(NEW."eventType", 128) OR NOT audit_v2_safe_text(NEW."ownerDomain", 128)
     OR NOT audit_v2_safe_text(NEW."scopeResolverId", 128) OR NOT audit_v2_safe_text(NEW."retentionClass", 128)
     OR NEW."registryDigest" !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'AUDIT_V2_INVALID_REGISTRY_TEXT'; END IF;
  IF jsonb_typeof(NEW."fieldSchema") <> 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(NEW."fieldSchema")) <> 3 OR
     NOT (NEW."fieldSchema" ?& ARRAY['before','after','metadata']) THEN RAISE EXCEPTION 'AUDIT_V2_INVALID_FIELD_SCHEMA'; END IF;
  values_array := NEW."actorTypes" || NEW."subjectTypes" || NEW."actions" || NEW."entityTypes" || NEW."outcomes" || NEW."sources";
  IF EXISTS (SELECT 1 FROM unnest(values_array) value WHERE NOT audit_v2_safe_text(value, 128))
     OR cardinality(NEW."actorTypes") <> (SELECT count(DISTINCT value) FROM unnest(NEW."actorTypes") value)
     OR cardinality(NEW."subjectTypes") <> (SELECT count(DISTINCT value) FROM unnest(NEW."subjectTypes") value)
     OR cardinality(NEW."actions") <> (SELECT count(DISTINCT value) FROM unnest(NEW."actions") value)
     OR cardinality(NEW."entityTypes") <> (SELECT count(DISTINCT value) FROM unnest(NEW."entityTypes") value)
     OR cardinality(NEW."outcomes") <> (SELECT count(DISTINCT value) FROM unnest(NEW."outcomes") value)
     OR cardinality(NEW."sources") <> (SELECT count(DISTINCT value) FROM unnest(NEW."sources") value) THEN
    RAISE EXCEPTION 'AUDIT_V2_INVALID_REGISTRY_ALLOWLIST';
  END IF;
  FOREACH section_name IN ARRAY ARRAY['before','after','metadata'] LOOP
    IF jsonb_typeof(NEW."fieldSchema"->section_name) <> 'object' THEN RAISE EXCEPTION 'AUDIT_V2_INVALID_FIELD_SCHEMA'; END IF;
    FOR field_key, definition IN SELECT key, value FROM jsonb_each(NEW."fieldSchema"->section_name)
    LOOP
      IF field_key !~ '^[a-z][A-Za-z0-9_.-]{0,127}$'
         OR field_key ~* '(password|authorization|cookie|secret|token|totp|recovery|ciphertext|auth.?tag|nonce|credential|request.?body|attachment)'
         OR definition->>'type' NOT IN ('string','number','boolean')
         OR definition->>'classification' NOT IN ('public_operational','masked')
         OR NOT audit_v2_safe_text(definition->>'label', 128)
         OR (definition->>'type' = 'string' AND COALESCE((definition->>'maxBytes')::INTEGER, 0) <= 0) THEN
        RAISE EXCEPTION 'AUDIT_V2_INVALID_FIELD_DEFINITION';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEventSchemaV2_insert_admission"
BEFORE INSERT ON "AuditEventSchemaV2"
FOR EACH ROW EXECUTE FUNCTION validate_audit_registry_v2_insert();

CREATE OR REPLACE FUNCTION validate_audit_event_v2_projection(target_event_id TEXT)
RETURNS void AS $$
DECLARE
  ev "AuditEventV2"%ROWTYPE;
  reg "AuditEventSchemaV2"%ROWTYPE;
  ref_count INTEGER;
  bad_ref_count INTEGER;
  ordinal_mismatch_count INTEGER;
BEGIN
  SELECT * INTO ev FROM "AuditEventV2" WHERE "id" = target_event_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO reg FROM "AuditEventSchemaV2"
    WHERE "eventType" = ev."eventType" AND "schemaVersion" = ev."schemaVersion"
      AND "registryDigest" = ev."registryDigest";
  IF NOT FOUND THEN RAISE EXCEPTION 'AUDIT_V2_REGISTRY_MISSING'; END IF;

  IF ev."registryDigestVersion" <> reg."registryDigestVersion"
     OR ev."authorizationScopeKind" <> reg."authorizationScopeKind"
     OR ev."scopeMatchMode" <> reg."scopeMatchMode"
     OR ev."requiredGlobalGrant" IS DISTINCT FROM reg."requiredGlobalGrant"
     OR ev."scopeResolverId" <> reg."scopeResolverId"
     OR ev."scopeResolverVersion" <> reg."scopeResolverVersion"
     OR ev."authorizationPolicyVersion" <> reg."authorizationPolicyVersion"
     OR ev."retentionClass" <> reg."retentionClass" THEN
    RAISE EXCEPTION 'AUDIT_V2_REGISTRY_BINDING_MISMATCH';
  END IF;
  IF NOT (ev."actorType" = ANY(reg."actorTypes")) OR NOT (ev."subjectType" = ANY(reg."subjectTypes"))
     OR NOT (ev."action" = ANY(reg."actions")) OR NOT (ev."entityType" = ANY(reg."entityTypes"))
     OR NOT (ev."outcome" = ANY(reg."outcomes")) OR NOT (ev."source" = ANY(reg."sources")) THEN
    RAISE EXCEPTION 'AUDIT_V2_ENVELOPE_NOT_REGISTERED';
  END IF;
  IF NOT audit_v2_safe_text(ev."actorId", 128) OR NOT audit_v2_safe_text(ev."actorType", 128)
     OR (ev."sessionId" IS NOT NULL AND NOT audit_v2_safe_text(ev."sessionId", 128))
     OR NOT audit_v2_safe_text(ev."subjectType", 128)
     OR (ev."subjectId" IS NOT NULL AND NOT audit_v2_safe_text(ev."subjectId", 128))
     OR NOT audit_v2_safe_text(ev."action", 128) OR NOT audit_v2_safe_text(ev."entityType", 128)
     OR (ev."entityId" IS NOT NULL AND NOT audit_v2_safe_text(ev."entityId", 128))
     OR (ev."entityVersion" IS NOT NULL AND NOT audit_v2_safe_text(ev."entityVersion", 128))
     OR (ev."approvalRequestId" IS NOT NULL AND NOT audit_v2_safe_text(ev."approvalRequestId", 128))
     OR (ev."approvalExecutionId" IS NOT NULL AND NOT audit_v2_safe_text(ev."approvalExecutionId", 128))
     OR (ev."bulkOperationId" IS NOT NULL AND NOT audit_v2_safe_text(ev."bulkOperationId", 128))
     OR (ev."bulkItemId" IS NOT NULL AND NOT audit_v2_safe_text(ev."bulkItemId", 128))
     OR NOT audit_v2_safe_text(ev."serverCorrelationId", 128)
     OR (ev."causationId" IS NOT NULL AND NOT audit_v2_safe_text(ev."causationId", 128))
     OR (ev."clientRequestId" IS NOT NULL AND (ev."clientRequestId" !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'))
     OR (ev."reasonCode" IS NOT NULL AND NOT audit_v2_safe_text(ev."reasonCode", 64)) THEN
    RAISE EXCEPTION 'AUDIT_V2_UNSAFE_ENVELOPE_TEXT';
  END IF;
  IF ev."resourceOwnerSnapshot" IS NOT NULL AND (
       jsonb_typeof(ev."resourceOwnerSnapshot") <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(ev."resourceOwnerSnapshot")) <> 2
       OR NOT (ev."resourceOwnerSnapshot" ?& ARRAY['kind','id'])
       OR NOT audit_v2_safe_text(ev."resourceOwnerSnapshot"->>'kind', 64)
       OR NOT audit_v2_safe_text(ev."resourceOwnerSnapshot"->>'id', 128)
     ) THEN RAISE EXCEPTION 'AUDIT_V2_INVALID_OWNER_SNAPSHOT'; END IF;
  IF NOT audit_v2_projection_is_valid(ev."safeBefore", reg."fieldSchema"->'before')
     OR NOT audit_v2_projection_is_valid(ev."safeAfter", reg."fieldSchema"->'after')
     OR NOT audit_v2_projection_is_valid(ev."safeMetadata", reg."fieldSchema"->'metadata')
     OR octet_length(jsonb_build_object('before', ev."safeBefore", 'after', ev."safeAfter", 'metadata', ev."safeMetadata")::text) > reg."maxProjectionBytes" THEN
    RAISE EXCEPTION 'AUDIT_V2_INVALID_SAFE_PROJECTION';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE NOT (r."dimension" = ANY(reg."allowedScopeDimensions")))
    INTO ref_count, bad_ref_count FROM "AuditEventScopeRefV2" r WHERE r."eventId" = target_event_id;
  SELECT count(*) INTO ordinal_mismatch_count FROM (
    SELECT "ordinal", row_number() OVER (ORDER BY "dimension", "scopeId") - 1 AS expected
    FROM "AuditEventScopeRefV2" WHERE "eventId" = target_event_id
  ) ordered_refs WHERE "ordinal" <> expected;

  IF bad_ref_count <> 0 OR ordinal_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'AUDIT_V2_NON_CANONICAL_SCOPE_REFS';
  END IF;
  IF ev."authorizationScopeKind" IN ('resource_scoped', 'cross_scope') AND ref_count = 0 THEN
    RAISE EXCEPTION 'AUDIT_V2_SCOPE_REFS_REQUIRED';
  END IF;
  IF ev."authorizationScopeKind" IN ('global_security', 'legacy_restricted') AND ref_count <> 0 THEN
    RAISE EXCEPTION 'AUDIT_V2_SCOPE_REFS_FORBIDDEN';
  END IF;
  IF ev."authorizationScopeKind" = 'cross_scope' AND ev."scopeMatchMode" <> 'all' THEN
    RAISE EXCEPTION 'AUDIT_V2_CROSS_SCOPE_REQUIRES_ALL';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_audit_event_v2_projection_trigger()
RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'AuditEventV2' THEN
    PERFORM validate_audit_event_v2_projection(NEW."id");
  ELSE
    PERFORM validate_audit_event_v2_projection(NEW."eventId");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "AuditEventV2_projection_admission"
AFTER INSERT ON "AuditEventV2" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_audit_event_v2_projection_trigger();
CREATE CONSTRAINT TRIGGER "AuditEventScopeRefV2_projection_admission"
AFTER INSERT ON "AuditEventScopeRefV2" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_audit_event_v2_projection_trigger();

CREATE OR REPLACE FUNCTION increment_security_control_version()
RETURNS trigger AS $$
BEGIN
  NEW."version" := OLD."version" + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SecurityControl_increment_version"
BEFORE UPDATE ON "SecurityControl" FOR EACH ROW EXECUTE FUNCTION increment_security_control_version();

CREATE OR REPLACE FUNCTION increment_role_version()
RETURNS trigger AS $$
BEGIN
  IF ROW(NEW."key", NEW."name", NEW."description", NEW."isSystem") IS DISTINCT FROM
     ROW(OLD."key", OLD."name", OLD."description", OLD."isSystem") THEN
    NEW."version" := OLD."version" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Role_increment_version"
BEFORE UPDATE ON "Role" FOR EACH ROW EXECUTE FUNCTION increment_role_version();

-- The sole authorization relation. V1/legacy rows are absent by construction.
-- It revalidates current account/session/control state and exact permission/scope
-- tuples; wildcard and unrelated permissions are never considered.
CREATE OR REPLACE FUNCTION authorized_audit_event_v2(viewer_id TEXT, viewer_session_id TEXT)
RETURNS TABLE("id" TEXT)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH valid_viewer AS (
    SELECT 1
    FROM "Admin" a
    JOIN "StaffSession" s ON s."staffUserId" = a."id" AND s."id" = viewer_session_id
    JOIN "SecurityControl" c ON c."id" = 1
    WHERE a."id" = viewer_id AND a."enabled" = true AND a."status" = 'active'
      AND s."revokedAt" IS NULL AND s."idleExpiresAt" > CURRENT_TIMESTAMP
      AND s."absoluteExpiresAt" > CURRENT_TIMESTAMP
      AND s."tokenVersionSnapshot" = a."tokenVersion"
      AND s."authContractVersion" >= c."minimumAuthContractVersion"
  ), exact_grants AS (
    SELECT ara."id" AS assignment_id, ara."scopeType"::text AS scope_kind,
           ara."scopeId" AS scope_id, p."key" AS permission
    FROM "AdminRoleAssignment" ara
    JOIN "RolePermission" rp ON rp."roleId" = ara."roleId"
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE ara."adminId" = viewer_id
  )
  SELECT e."id"
  FROM "AuditEventV2" e
  JOIN "AuditEventSchemaV2" reg ON reg."eventType" = e."eventType"
    AND reg."schemaVersion" = e."schemaVersion" AND reg."registryDigest" = e."registryDigest"
  WHERE EXISTS (SELECT 1 FROM valid_viewer)
    AND EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = 'audit.read')
    AND (
      (e."authorizationScopeKind" = 'resource_scoped'
       AND EXISTS (SELECT 1 FROM "AuditEventScopeRefV2" r WHERE r."eventId" = e."id")
       AND (
         (e."scopeMatchMode" = 'all' AND NOT EXISTS (
           SELECT 1 FROM "AuditEventScopeRefV2" r WHERE r."eventId" = e."id"
             AND NOT EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = 'audit.read'
               AND g.scope_kind = r."dimension" AND g.scope_id = r."scopeId")
         ))
         OR
         (e."scopeMatchMode" = 'any' AND EXISTS (
           SELECT 1 FROM "AuditEventScopeRefV2" r JOIN exact_grants g
             ON g.permission = 'audit.read' AND g.scope_kind = r."dimension" AND g.scope_id = r."scopeId"
           WHERE r."eventId" = e."id"
         ))
         OR
         (reg."allowGlobalReader" AND EXISTS (SELECT 1 FROM exact_grants g
           WHERE g.permission = 'audit.read' AND g.scope_kind = 'global' AND g.scope_id = ''))
       ))
      OR
      (e."authorizationScopeKind" = 'global_security'
       AND NOT EXISTS (SELECT 1 FROM "AuditEventScopeRefV2" r WHERE r."eventId" = e."id")
       AND EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = 'audit.read'
         AND g.scope_kind = 'global' AND g.scope_id = '')
       AND e."requiredGlobalGrant" IS NOT NULL
       AND EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = e."requiredGlobalGrant"
         AND g.scope_kind = 'global' AND g.scope_id = ''))
      OR
      (e."authorizationScopeKind" = 'cross_scope'
       AND e."scopeMatchMode" = 'all'
       AND EXISTS (SELECT 1 FROM "AuditEventScopeRefV2" r WHERE r."eventId" = e."id")
       AND (
         NOT EXISTS (
           SELECT 1 FROM "AuditEventScopeRefV2" r WHERE r."eventId" = e."id"
             AND NOT EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = 'audit.read'
               AND g.scope_kind = r."dimension" AND g.scope_id = r."scopeId")
         )
         OR
         (e."requiredGlobalGrant" IS NOT NULL
          AND EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = 'audit.read'
            AND g.scope_kind = 'global' AND g.scope_id = '')
          AND EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = e."requiredGlobalGrant"
            AND g.scope_kind = 'global' AND g.scope_id = ''))
       ))
    );
$$;

-- Explicit least-privilege role contracts. The application deployment may
-- grant these group roles to separate connection users; ordinary public access
-- and write privileges are denied here regardless.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tyre_audit_v2_writer') THEN
    CREATE ROLE tyre_audit_v2_writer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tyre_audit_v2_reader') THEN
    CREATE ROLE tyre_audit_v2_reader NOLOGIN;
  END IF;
END $$;
REVOKE ALL ON "AuditEventSchemaV2", "AuditEventV2", "AuditEventScopeRefV2" FROM PUBLIC;
GRANT INSERT ON "AuditEventV2", "AuditEventScopeRefV2" TO tyre_audit_v2_writer;
GRANT SELECT ON "AuditEventSchemaV2", "AuditEventV2", "AuditEventScopeRefV2",
  "Admin", "StaffSession", "SecurityControl", "AdminRoleAssignment", "Role", "RolePermission", "Permission"
  TO tyre_audit_v2_reader;
REVOKE ALL ON FUNCTION authorized_audit_event_v2(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authorized_audit_event_v2(TEXT, TEXT) TO tyre_audit_v2_reader;
