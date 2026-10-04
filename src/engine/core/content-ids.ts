import type { Rule } from './types';

/** Puzzle/session id of a written rule. Stable v3 ids win; v2 keeps its positional compatibility id. */
export function ruleActionId(scope: string, index: number, rule: Rule): string {
  return `rule:${rule.id ?? `${scope}/on[${index}]`}`;
}
