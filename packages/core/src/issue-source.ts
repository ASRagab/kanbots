import type {
  Comment,
  CreateIssueInput,
  Issue,
  OpenPRInput,
  PullRequest,
  UpdateIssuePatch,
} from './types.js';

/**
 * The contract every issue backend implements.
 *
 * Two implementations exist (or will exist):
 *   - GitHubIssueSource — issues live on github.com (current default)
 *   - LocalIssueSource — issues live in the workspace's SQLite, no remote
 */
export interface IssueSource {
  listIssues(opts?: { state?: 'open' | 'closed' | 'all' }): Promise<Issue[]>;
  getIssue(number: number): Promise<Issue>;
  createIssue(input: CreateIssueInput): Promise<Issue>;
  updateIssue(number: number, patch: UpdateIssuePatch): Promise<Issue>;
  listComments(number: number): Promise<Comment[]>;
  addComment(number: number, body: string): Promise<Comment>;
  // Optional — only github-backed sources can open PRs.
  openDraftPR?(input: OpenPRInput): Promise<PullRequest>;
}
