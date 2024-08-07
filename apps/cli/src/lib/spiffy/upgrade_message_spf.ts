import * as t from '@withgraphite/retype';
import { spiffy } from './spiffy';

const schema = t.shape({
  message: t.optional(
    t.shape({
      contents: t.string,
      cliVersion: t.string,
    })
  ),
});

export const messageConfigFactory = spiffy({
  schema,
  defaultLocations: [
    {
      relativePath: '.freephite_upgrade_message',
      relativeTo: 'USER_HOME',
    },
  ],
  initialize: () => {
    return {
      message: undefined,
    };
  },
  helperFunctions: () => {
    return {};
  },
  options: { removeIfEmpty: true },
});

export type TMessageConfig = ReturnType<typeof messageConfigFactory.load>;
