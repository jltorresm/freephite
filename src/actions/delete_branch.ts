import { ExitFailedError } from "../lib/errors";
import { gpExecSync } from "../lib/utils";
import { MetadataRef } from "../wrapper-classes";

export function deleteBranchAction(args: {
  branchName: string;
  force: boolean;
}): void {
  const meta = new MetadataRef(args.branchName);
  meta.delete();

  gpExecSync(
    {
      command: `git branch ${args.force ? "-D" : "-d"} ${args.branchName}`,
    },
    (err) => {
      throw new ExitFailedError("Failed to delete branch. Aborting...", err);
    }
  );
}
