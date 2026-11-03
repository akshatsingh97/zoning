export type ZoneTier = 'critical' | 'shared' | 'open';

export type PathRuleCategory = 'money' | 'auth' | 'infra';

export interface PathRule {
  pattern: RegExp;
  category: PathRuleCategory;
  label: string;
}

function rule(sources: string[], category: PathRuleCategory, label: string): PathRule {
  return { pattern: new RegExp(`(${sources.join('|')})`, 'i'), category, label };
}

export const DEFAULT_PATH_RULES: PathRule[] = [
  rule(['payment', 'billing', 'checkout', 'charge', 'invoice', 'refund'], 'money', 'money'),
  rule(['auth', 'session', 'permission', 'login', 'password'], 'auth', 'auth'),
  rule(
    ['migration', 'terraform', 'infra', 'dockerfile', 'k8s', 'kubernetes', '\\.github/workflows'],
    'infra',
    'infra',
  ),
];

export interface ScanThresholds {
  sharedFanIn: number;
  sparkTopN: number;
}

export const DEFAULT_THRESHOLDS: ScanThresholds = {
  sharedFanIn: 3,
  sparkTopN: 20,
};

export function matchPathRule(posixPath: string, rules: PathRule[] = DEFAULT_PATH_RULES): PathRule | undefined {
  return rules.find((r) => r.pattern.test(posixPath));
}
