import { IsString, Length, Matches } from 'class-validator';

/** Read-only bank reconciliation always fetches one bounded provider snapshot. */
export class BankReconciliationDto {
  @IsString() @Length(1, 80)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/)
  bankConfigId!: string;
}
