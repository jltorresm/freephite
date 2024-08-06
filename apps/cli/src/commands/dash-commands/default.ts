import open from 'open';
import yargs from 'yargs';
import { graphite } from '../../lib/runner';

const args = {} as const;

export const command = '*';
export const description = 'Opens your Graphite dashboard in the web.';
export const builder = args;
export const canonical = 'dash';
export const aliases = ['d'];

type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const handler = async (argv: argsT): Promise<void> =>
  graphite(argv, canonical, async (context) => {
    const dashboardUrl = `https://github.com/${context.repoConfig.getRepoOwner()}/${context.repoConfig.getRepoName()}`;
    return void open(dashboardUrl);
  });
