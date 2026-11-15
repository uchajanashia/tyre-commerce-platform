import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export const AUDIT_QUERY_KEYS = [
  'occurredFrom', 'occurredTo', 'eventFamily', 'outcome', 'actorId', 'entityType', 'entityId',
  'approvalRequestId', 'approvalExecutionId', 'serverCorrelationId', 'causationId',
  'bulkOperationId', 'bulkItemId', 'source', 'retentionClass', 'sortField', 'sortDirection',
  'pageSize', 'cursor',
] as const;

export class AuditEventListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) occurredFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) occurredTo?: string;
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) eventFamily?: string;
  @ApiPropertyOptional({ enum: ['succeeded', 'failed', 'denied'] }) @IsOptional() @IsIn(['succeeded', 'failed', 'denied']) outcome?: 'succeeded' | 'failed' | 'denied';
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) actorId?: string;
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) entityType?: string;
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) entityId?: string;
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) approvalRequestId?: string;
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) approvalExecutionId?: string;
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) serverCorrelationId?: string;
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) causationId?: string;
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) bulkOperationId?: string;
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) bulkItemId?: string;
  @ApiPropertyOptional({ enum: ['admin_api', 'job', 'webhook', 'import', 'system'] }) @IsOptional() @IsIn(['admin_api', 'job', 'webhook', 'import', 'system']) source?: 'admin_api' | 'job' | 'webhook' | 'import' | 'system';
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) retentionClass?: string;
  @ApiPropertyOptional({ enum: ['occurredAt', 'eventType', 'outcome'] }) @IsOptional() @IsIn(['occurredAt', 'eventType', 'outcome']) sortField?: 'occurredAt' | 'eventType' | 'outcome';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) sortDirection?: 'asc' | 'desc';
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}

export class AuditSafeFieldDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: ['public_operational', 'masked'] }) classification!: 'public_operational' | 'masked';
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] })
  value!: string | number | boolean | null;
}

export class AuditScopeRefDto {
  @ApiProperty({ enum: ['warehouse', 'channel', 'company'] }) dimension!: 'warehouse' | 'channel' | 'company';
  @ApiProperty() id!: string;
}

export class AuditEventSummaryDto {
  @ApiProperty() eventId!: string;
  @ApiProperty() eventType!: string;
  @ApiProperty() schemaVersion!: number;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty() actorId!: string;
  @ApiProperty() actorType!: string;
  @ApiProperty() subjectType!: string;
  @ApiPropertyOptional() subjectId?: string;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiPropertyOptional() entityId?: string;
  @ApiPropertyOptional() entityVersion?: string;
  @ApiProperty({ enum: ['succeeded', 'failed', 'denied'] }) outcome!: 'succeeded' | 'failed' | 'denied';
  @ApiProperty({ enum: ['admin_api', 'job', 'webhook', 'import', 'system'] }) source!: 'admin_api' | 'job' | 'webhook' | 'import' | 'system';
  @ApiProperty() retentionClass!: string;
  @ApiProperty() serverCorrelationId!: string;
  @ApiPropertyOptional() approvalRequestId?: string;
  @ApiPropertyOptional() approvalExecutionId?: string;
  @ApiProperty({ type: [String], maxItems: 0 }) allowedActions!: [];
}

export class AuditEventDetailDto extends AuditEventSummaryDto {
  @ApiProperty({ enum: ['resource_scoped', 'global_security', 'cross_scope', 'legacy_restricted'] })
  authorizationScopeKind!: 'resource_scoped' | 'global_security' | 'cross_scope' | 'legacy_restricted';
  @ApiProperty({ type: [AuditScopeRefDto] }) authorizationScopeRefs!: AuditScopeRefDto[];
  @ApiProperty({ enum: ['all', 'any'] }) scopeMatchMode!: 'all' | 'any';
  @ApiProperty() scopeResolverId!: string;
  @ApiProperty() scopeResolverVersion!: number;
  @ApiProperty() authorizationPolicyVersion!: number;
  @ApiPropertyOptional() reasonCode?: string;
  @ApiProperty({ type: [AuditSafeFieldDto] }) before!: AuditSafeFieldDto[];
  @ApiProperty({ type: [AuditSafeFieldDto] }) after!: AuditSafeFieldDto[];
  @ApiProperty({ type: [AuditSafeFieldDto] }) metadata!: AuditSafeFieldDto[];
  @ApiPropertyOptional() causationId?: string;
  @ApiPropertyOptional() clientRequestId?: string;
  @ApiPropertyOptional() bulkOperationId?: string;
  @ApiPropertyOptional() bulkItemId?: string;
}

export class AuditEventListResponseDto {
  @ApiProperty({ type: [AuditEventSummaryDto] }) items!: AuditEventSummaryDto[];
  @ApiPropertyOptional() nextCursor?: string;
  @ApiProperty({ format: 'date-time' }) asOfOccurredAt!: string;
  @ApiProperty({ type: [String], maxItems: 0 }) allowedActions!: [];
}
