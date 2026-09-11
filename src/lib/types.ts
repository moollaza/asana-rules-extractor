// --- Raw extraction (what the DOM says) -------------------------------------

export interface PersonGid {
  userGid: string;
  domainUserGid: string | null;
}

export interface UnknownPeople {
  namesUnavailable: true;
  count: number | null;
  gids: PersonGid[];
}

/** One flowchart card, before any interpretation. */
export interface Entry {
  text: string;
  pills: string[];
  hasField: boolean;
  /** Custom field name from the field pill, when the card has one. */
  field?: string;
  /** Full value list read from the side pane when the card showed "+N". */
  values?: string[];
  incomplete?: boolean;
  hiddenValueCount?: number;
  people?: string[] | UnknownPeople;
  gids?: PersonGid[];
  /** True only when the DOM ties the single name to the single avatar. */
  gidsPaired?: boolean;
  /** The card's value is a "Use AI" pill: the AI picks it at run time. */
  useAi?: true;
}

/** An object referenced from the rule's AI instructions (project pill etc.). */
export interface ObjectRef {
  type: string;
  name: string;
  gid: string;
}

/** The rule's AI Instructions text, with embedded object pills listed out. */
export interface AiInstructions {
  text: string;
  references: ObjectRef[];
}

export interface RawBranch {
  kind: string | null;
  if: Entry[];
  do: Entry[];
}

export interface RawRule {
  id: string | null;
  name: string | null;
  project: string | null;
  status: string | null;
  lastRun: string | null;
  when: Entry[];
  branches: RawBranch[];
  /** Present when at least one card says "Use AI" and the Instructions card was read. */
  aiInstructions?: AiInstructions;
}

// --- Shaped output (what an agent reads) ------------------------------------

export interface IncompleteCondition {
  condition: string;
  incomplete: true;
  hiddenValueCount?: number;
}
/** A condition whose phrasing is unknown but whose full value list was expanded. */
export interface ExpandedCondition {
  condition: string;
  values: string[];
}
export type Condition = string | IncompleteCondition | ExpandedCondition;
export type ConditionGroup = { all: Condition[] } | { any: Condition[] };

export type Action = Record<string, unknown>;

export interface Branch {
  /** `'otherwise'` is the catch-all else path. */
  if: ConditionGroup | "otherwise";
  do: Action[];
}

export interface Rule {
  id: string | null;
  name: string | null;
  project?: string | null;
  status: string | null;
  lastRun: string | null;
  when: ConditionGroup;
  branches: Branch[];
  /**
   * Rule-level AI Instructions. Any action valued `{ useAI: true }` is decided
   * at run time from this text.
   */
  aiInstructions?: AiInstructions;
  /** Reads that may be wrong or incomplete. Treat the rule as unverified. */
  warnings?: string[];
  /** Actions read in full but with no typed key yet; see `action` text. */
  untyped?: number;
}

export interface FailedRule {
  name: string;
  error: string;
}

export interface RuleSet {
  project: string | null;
  rules: (Rule | FailedRule)[];
}

export type Result = Rule | RuleSet;

// --- Run log ------------------------------------------------------------------

export interface Snapshot {
  name: string | null;
  digest: string;
  html: string;
}

export interface RunRecord {
  mode: "all" | "one";
  startedAt?: string;
  finishedAt: string;
  url: string;
  version: string;
  result: Result | null;
  log: string[];
  snapshots: Snapshot[];
}

// --- Messages -----------------------------------------------------------------

export type ContentRequest =
  | { type: "ping" }
  | { type: "state" }
  | { type: "stop" }
  | { type: "clear" }
  | { type: "dump" }
  | { type: "readOpenRule" }
  | { type: "readAllRules" };

export type BackgroundRequest = { type: "runFinished"; record: RunRecord };

export interface RunOutcome {
  result: Result | null;
  stopped?: boolean;
  alreadyRunning?: boolean;
}

export interface StateResponse {
  running: boolean;
  /** True when the last run ended because Stop was pressed. */
  stopped: boolean;
  result: Result | null;
  log: string[];
}

export type Ok<T> = { ok: true } & T;
export type Fail = { ok: false; error: string };
export type Response<T> = Ok<T> | Fail;

export function isRuleSet(result: Result): result is RuleSet {
  return "rules" in result;
}

export function rulesOf(result: Result): (Rule | FailedRule)[] {
  return isRuleSet(result) ? result.rules : [result];
}

export function isFailed(rule: Rule | FailedRule): rule is FailedRule {
  return "error" in rule;
}
