export const TEAM_ALIAS_LIMIT = 20;
export const TEAM_ALIAS_CREATE_BATCH_LIMIT = 20;

export function formatAliasLimit() {
  return TEAM_ALIAS_LIMIT.toLocaleString("vi-VN");
}
