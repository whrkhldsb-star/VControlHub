/** A platform rule can span customers. A customer rule stays within its own. */
export function canAlertRuleTargetTeam(ruleTeamId: string | null | undefined, targetTeamId: string | null): boolean {
  return ruleTeamId == null || ruleTeamId === targetTeamId;
}
