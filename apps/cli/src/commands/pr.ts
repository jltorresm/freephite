import yargs from 'yargs';

export const command = 'prs <command>';
export const desc = 'Commands to query PRs. Run `fp prs --help` to learn more.';
// export const aliases = ['p']; // TODO: Figure why this doesn't behave as expected.
export const builder = function (yargs: yargs.Argv): yargs.Argv {
  return yargs
    .commandDir('pr-commands', {
      extensions: ['js'],
    })
    .strict()
    .demandCommand();
};
