import { ResolutionDecision } from '../../domain/use-cases/resolve-authorization.use-case';

export class ResolveAuthorizationDto {
  decision!: ResolutionDecision;
  supervisor_id!: string;
}
