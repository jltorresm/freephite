import open from 'open';
import yargs from 'yargs';
import { graphite } from '../../lib/runner';

const args = {
  pr: {
    describe: `An PR number or branch name to open.`,
    demandOption: false,
    positional: true,
    type: 'string',
    hidden: true,
  },
} as const;

export const command = 'pr [pr]';
export const description =
  'Opens the PR page for the current (or provided) branch (or pr number).';
export const builder = args;
export const canonical = 'dash pr';
export const aliases = ['p'];

type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const handler = async (argv: argsT): Promise<void> =>
  graphite(argv, canonical, async (context) => {
    const prPath = `https://github.com/${context.repoConfig.getRepoOwner()}/${context.repoConfig.getRepoName()}`;
    const dashboardUrl = `${prPath}/pulls`;

    const prNumber = parseInt(argv.pr || '');
    if (prNumber) {
      return void open(`${prPath}/pull/${prNumber}`);
    }

    const branchName = argv.pr ? argv.pr : context.engine.currentBranch;

    const branchPrNumber = branchName
      ? context.engine.getPrInfo(branchName)?.number
      : undefined;

    if (branchPrNumber) {
      return void open(`${prPath}/pull/${branchPrNumber}`);
    }

    return void open(dashboardUrl);
  });
