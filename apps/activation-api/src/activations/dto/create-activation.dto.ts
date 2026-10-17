import { SIMULATE_FAILURE, type SimulateFailure } from '@poc/contracts';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateActivationDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsString()
  @IsNotEmpty()
  planId: string;

  @IsOptional()
  @IsIn(SIMULATE_FAILURE)
  simulateFailure?: SimulateFailure;
}
