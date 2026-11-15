import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export const JOB_QUERY_KEYS = ['state','jobType','ownerDomain','correlationId','createdFrom','createdTo','sortField','sortDirection','pageSize','cursor'] as const;
const states = ['queued','processing','succeeded','known_safe_failure','external_outcome_unknown','dead_lettered','cancelled_before_effect','reconciling','reconciled_applied','reconciled_not_applied'] as const;

export class JobListQueryDto {
  @ApiPropertyOptional({ enum: states }) @IsOptional() @IsIn(states) state?: typeof states[number];
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) jobType?: string;
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) ownerDomain?: string;
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) correlationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) createdFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) createdTo?: string;
  @ApiPropertyOptional({ enum: ['createdAt','availableAt','state','priority'] }) @IsOptional() @IsIn(['createdAt','availableAt','state','priority']) sortField?: 'createdAt'|'availableAt'|'state'|'priority';
  @ApiPropertyOptional({ enum: ['asc','desc'] }) @IsOptional() @IsIn(['asc','desc']) sortDirection?: 'asc'|'desc';
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}

export class JobSafeFieldDto { @ApiProperty() key!: string; @ApiProperty() label!: string; @ApiProperty({ enum:['public_operational','masked'] }) classification!: 'public_operational'|'masked'; @ApiProperty() value!: string|number|boolean|null; }
export class JobSummaryDto {
  @ApiProperty() jobId!: string; @ApiProperty() jobType!: string; @ApiProperty() schemaVersion!: number; @ApiProperty() ownerDomain!: string;
  @ApiProperty({ enum: states }) state!: typeof states[number]; @ApiProperty() priority!: number;
  @ApiProperty({ format:'date-time' }) createdAt!: string; @ApiProperty({ format:'date-time' }) availableAt!: string;
  @ApiProperty() serverCorrelationId!: string; @ApiPropertyOptional() causationId?: string; @ApiProperty() originatingAuditEventId!: string;
  @ApiProperty({ type:[JobSafeFieldDto] }) safeSummary!: JobSafeFieldDto[]; @ApiProperty({ type:[String],maxItems:0 }) allowedActions!: [];
}
export class JobAttemptFactDto { @ApiProperty() attemptStartedId!: string; @ApiProperty() leaseGeneration!: number; @ApiProperty({format:'date-time'}) startedAt!: string; @ApiPropertyOptional({enum:['succeeded','known_safe_failure','external_outcome_unknown','dead_lettered','cancelled_before_effect']}) outcome?: string; @ApiPropertyOptional({format:'date-time'}) outcomeAt?: string; @ApiPropertyOptional() safeReasonCode?: string; }
export class JobReconciliationFactDto { @ApiProperty() reconciliationId!: string; @ApiProperty({enum:['reconciling','reconciled_applied','reconciled_not_applied']}) state!: string; @ApiProperty({format:'date-time'}) occurredAt!: string; @ApiProperty() safeReasonCode!: string; }
export class JobScopeRefDto { @ApiProperty({enum:['warehouse','channel','company']}) dimension!: 'warehouse'|'channel'|'company'; @ApiProperty() id!: string; }
export class JobDetailDto extends JobSummaryDto {
  @ApiProperty({enum:['resource_scoped','global_operations','cross_scope','legacy_restricted']}) authorizationScopeKind!: string;
  @ApiProperty({type:[JobScopeRefDto]}) authorizationScopeRefs!: JobScopeRefDto[]; @ApiProperty({enum:['all','any']}) scopeMatchMode!: 'all'|'any';
  @ApiPropertyOptional() requiredGlobalGrant?: string; @ApiProperty() scopeResolverId!: string; @ApiProperty() scopeResolverVersion!: number; @ApiProperty() authorizationPolicyVersion!: number;
  @ApiProperty() currentLeaseGeneration!: number; @ApiPropertyOptional({format:'date-time'}) leaseExpiresAt?: string;
  @ApiProperty({type:[JobAttemptFactDto]}) attempts!: JobAttemptFactDto[]; @ApiProperty({type:[JobReconciliationFactDto]}) reconciliations!: JobReconciliationFactDto[];
}
export class JobListResponseDto { @ApiProperty({type:[JobSummaryDto]}) items!: JobSummaryDto[]; @ApiPropertyOptional() nextCursor?: string; @ApiProperty({format:'date-time'}) asOfCreatedAt!: string; @ApiProperty({type:[String],maxItems:0}) allowedActions!: []; }
