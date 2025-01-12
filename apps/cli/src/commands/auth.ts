import chalk from 'chalk';
import yargs from 'yargs';
import { graphiteWithoutRepo } from '../lib/runner';

const args = {
  token: {
    type: 'string',
    alias: 't',
    describe: 'Github Auth token from: https://github.com/settings/tokens',
    demandOption: false,
  },
} as const;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const command = 'auth';
export const description = 'Add your Github auth token.';
export const builder = args;
export const canonical = 'auth';

export const handler = async (argv: argsT): Promise<void> => {
  return graphiteWithoutRepo(argv, canonical, async (context) => {
    if (argv.token) {
      context.userConfig.update((data) => (data.authToken = argv.token));
      context.userConfig.update((data) => (data.fpAuthToken = argv.token));
      context.splog.info(
        chalk.green(`🔐 Saved auth token to "${context.userConfig.path}"`)
      );
      return;
    }

    const existing = context.userConfig.getFPAuthToken();
    if (existing) {
      context.splog.info(`Existing auth token: ${existing}`);
    } else {
      context.splog.error('No auth token set.');
    }
  });
};
