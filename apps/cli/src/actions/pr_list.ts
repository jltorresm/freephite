import { TContext } from '../lib/context';
import { Octokit } from '@octokit/core';
import { OctokitResponse } from '@octokit/types';
import { TeamInfo, UserInfo } from './get_user_info';

export interface PullRequestInfo {
  id: number;
  url: string;
  html_url: string;
  diff_url: string;
  number: number;
  title: string;
  state: string;
  user: UserInfo;
  created_at: string;
  requested_reviewers: Array<UserInfo>;
  requested_teams: Array<TeamInfo>;
  draft: boolean;
  head: { ref: string };
  base: { ref: string };
  auto_merge: { merge_method: string } | null;
}

export type PullRequests = Array<PullRequestInfo>;

export async function getPRs({
  context,
  filter,
}: {
  context: TContext;
  filter?: (pr: PullRequestInfo) => boolean;
}): Promise<PullRequests> {
  const auth = context.userConfig.getFPAuthToken();
  if (!auth) {
    throw new Error(
      'No freephite auth token found. Run `fp auth-fp -t <YOUR_GITHUB_TOKEN>` then try again.'
    );
  }

  const octokit = new Octokit({ auth });

  const owner = context.repoConfig.getRepoOwner();
  const repo = context.repoConfig.getRepoName();

  const nextPattern = /(?<=<)([\S]*)(?=>; rel="Next")/i;
  let pagesRemaining = true;
  let pull_requests: PullRequests = [];
  let url = '/repos/{owner}/{repo}/pulls';

  while (pagesRemaining) {
    const response: OctokitResponse<PullRequests, number> =
      await octokit.request(`GET ${url}`, {
        owner,
        repo,
        // state: 'open',
        sort: 'created',
        direction: 'desc',
        per_page: 100,
        headers: { 'X-GitHub-Api-Version': '2022-11-28' },
      });

    const filtered_prs = filter
      ? response.data.filter((pr) => filter(pr))
      : response.data;

    pull_requests = [...pull_requests, ...filtered_prs];

    const linkHeader = response.headers.link;

    pagesRemaining = !!linkHeader && linkHeader.includes(`rel="next"`);

    if (pagesRemaining) {
      url = linkHeader?.match(nextPattern)?.[0] ?? '';
    }
  }

  return pull_requests;
}
