import yargs from 'yargs';
import { graphite } from '../../lib/runner';
import { getPRs, PullRequestInfo } from '../../actions/pr_list';
import {
  getCurrentUser,
  getUserTeams,
  Teams,
} from '../../actions/get_user_info';
import chalk from 'chalk';
import prompts from 'prompts';
import { clearPromptResultLine } from '../../lib/utils/prompts_helpers';
import open from 'open';

export const args = {
  user: {
    describe: `A GitHub username to query the PRs from. If not given uses the authenticated user.`,
    demandOption: false,
    positional: true,
    type: 'string',
    hidden: false,
  },
  exclude_teams: {
    describe: `Exclude review requests made for the user's teams.`,
    alias: 't',
    demandOption: false,
    positional: false,
    type: 'boolean',
    default: false,
    hidden: false,
  },
} as const;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const command = 'review-requested [user]';
export const canonical = 'prs review-requested';
export const description = 'Shows PRs the user needs to review.';
export const aliases = ['rr'];
export const builder = args;

export const handler = async (argv: argsT): Promise<void> =>
  graphite(argv, canonical, async (context) => {
    const username = argv.user ?? (await getCurrentUser({ context })).login;
    let teams: Teams = [];

    context.splog.info(`Getting review requests for ${chalk.green(username)}.`);

    if (!argv.exclude_teams) {
      context.splog.info(chalk.cyan(`Including user's teams!`));
      teams = await getUserTeams({ context, username });
    } else {
      context.splog.warn(`Excluding user's teams!`);
    }

    const filter = getFilterReviewRequested(username, teams);

    const prs = (await getPRs({ context, filter })).map((pr) => ({
      title: `${getPRTitleLine(pr)}\n        ${chalk.magenta(pr.html_url)}`,
      value: pr.html_url,
    }));

    const { prUrl } = await context.prompts(
      {
        type: 'autocomplete',
        name: 'prUrl',
        message: 'Select a PR to open',
        choices: prs,
        initial: -1,
        limit: 30,
        suggest: (input) =>
          Promise.resolve(
            prs.filter((c: prompts.Choice) =>
              c.title.toLocaleLowerCase().includes(input.toLocaleLowerCase())
            )
          ),
      },
      {
        onCancel: (_prompt, _answers) => {
          context.splog.warn('Selection cancelled by user.\n');
        },
      }
    );

    clearPromptResultLine();
    context.splog.debug(`Selected ${prUrl}`);

    return void (prUrl ? open(prUrl) : null);
  });

function getFilterReviewRequested(
  username: string,
  teams: Teams
): (pr: PullRequestInfo) => boolean {
  return (pr: PullRequestInfo): boolean => {
    for (const reviewer of pr.requested_reviewers) {
      if (reviewer.login == username) return true;
    }
    for (const requested_team of pr.requested_teams) {
      for (const user_team of teams) {
        if (requested_team.name == user_team.name) return true;
      }
    }
    return false;
  };
}
function getPRTitleLine(pr: PullRequestInfo): string {
  const prNumber = `PR #${pr.number}`;

  if (pr?.state.toLowerCase() === 'merged') {
    return `${prNumber} (merged) ${pr.title}`;
  } else if (pr?.state.toLowerCase() === 'closed') {
    return `${prNumber} (abandoned) ${chalk.strikethrough(`${pr.title}`)}`;
  } else {
    return `${chalk.yellow(prNumber)} ${chalk.gray(`(${pr.state})`)} ${
      pr.title
    }`;
  }
}
