import { TContext } from '../lib/context';
import { Octokit } from '@octokit/core';

export interface UserInfo {
  login: string;
  url: string;
}

export interface TeamInfo {
  name: string;
  url: string;
  description: string;
  members: {
    nodes: Array<UserInfo>;
  };
  members_url?: string;
}
export type Teams = Array<TeamInfo>;

export async function getCurrentUser({
  context,
}: {
  context: TContext;
}): Promise<UserInfo> {
  const auth = context.userConfig.getFPAuthToken();
  if (!auth) {
    throw new Error(
      'No freephite auth token found. Run `fp auth-fp -t <YOUR_GITHUB_TOKEN>` then try again.'
    );
  }

  const octokit = new Octokit({ auth });

  const response = await octokit.request('GET /user', {
    headers: { 'X-GitHub-Api-Version': '2022-11-28' },
  });

  return response.data;
}

export async function getUserTeams({
  context,
  username,
}: {
  context: TContext;
  username: string;
}): Promise<Teams> {
  const auth = context.userConfig.getFPAuthToken();
  if (!auth) {
    throw new Error(
      'No freephite auth token found. Run `fp auth-fp -t <YOUR_GITHUB_TOKEN>` then try again.'
    );
  }

  const octokit = new Octokit({ auth });

  const {
    organization: {
      teams: { nodes: teams },
    },
  } = await octokit.graphql(
    `
      query userTeams($org: String!, $username: String!) {
        organization(login: $org) {
          teams(first: 100, userLogins: [$username]) {
            totalCount
            nodes {
              name
              url
              description
              members {
                nodes {
                  login
                  name
                }
              }
            }
          }
        }
      }
  `,
    {
      org: context.repoConfig.getRepoOwner(),
      username,
    }
  );

  return (teams as Array<TeamInfo>).sort(
    (a: TeamInfo, b: TeamInfo) =>
      a.members.nodes.length - b.members.nodes.length
  );
}
