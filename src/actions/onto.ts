import chalk from "chalk";
import { execSync } from "child_process";
import { validate } from "../actions/validate";
import PrintStacksCommand from "../commands/original-commands/print-stacks";
import { log } from "../lib/log";
import {
  checkoutBranch,
  CURRENT_REPO_CONFIG_PATH,
  logErrorAndExit,
  trunkBranches,
  uncommittedChanges,
} from "../lib/utils";
import Branch from "../wrapper-classes/branch";
import { restackBranch } from "./fix";
export async function ontoAction(onto: string, silent: boolean): Promise<void> {
  if (uncommittedChanges()) {
    logErrorAndExit("Cannot restack with uncommitted changes");
  }
  // Print state before
  log(`Before restack:`, { silent });
  !silent && (await new PrintStacksCommand().executeUnprofiled({ silent }));

  const originalBranch = Branch.getCurrentBranch();
  if (originalBranch === null) {
    logErrorAndExit(`Not currently on a branch; no target to restack.`);
  }

  await restackOnto(originalBranch, onto, silent);

  checkoutBranch(originalBranch.name);

  // Print state after
  log(`After restack:`, { silent });
  !silent && (await new PrintStacksCommand().executeUnprofiled({ silent }));
}

async function restackOnto(
  currentBranch: Branch,
  onto: string,
  silent: boolean
) {
  // Check that the current branch has a parent to prevent moving main
  checkBranchCanBeMoved(currentBranch, onto, silent);
  await validateStack(silent);
  const parent = getParentForRebaseOnto(currentBranch, silent);
  // Save the old ref from before rebasing so that children can find their bases.
  currentBranch.setMetaPrevRef(currentBranch.getCurrentRef());
  execSync(
    `git rebase --onto ${onto} $(git merge-base ${currentBranch.name} ${parent.name}) ${currentBranch.name}`,
    { stdio: "ignore" }
  );
  // set current branch's parent only if the rebase succeeds.
  currentBranch.setParentBranchName(onto);
  // Now perform a restack starting from the onto branch:
  for (const child of await currentBranch.getChildrenFromMeta()) {
    await restackBranch(child, silent);
  }
}
async function validateStack(silent: boolean) {
  try {
    await validate("UPSTACK", silent);
  } catch {
    log(
      chalk.red(
        `Cannot "restack --onto", git derived stack must match meta defined stack. Consider running "restack" or "fix" first.`
      ),
      { silent }
    );
    process.exit(1);
  }
}

function checkBranchCanBeMoved(branch: Branch, onto: string, silent: boolean) {
  if (trunkBranches && branch.name in trunkBranches) {
    log(
      chalk.red(
        `Cannot restack (${branch.name}) onto ${onto}, (${branch.name}) is listed in (${CURRENT_REPO_CONFIG_PATH}) as a trunk branch.`
      ),
      { silent }
    );
    process.exit(1);
  }
}

function getParentForRebaseOnto(branch: Branch, silent: boolean): Branch {
  const parent = branch.getParentFromMeta();
  if (!parent) {
    log(
      chalk.red(
        `Cannot "restack --onto", (${branch.name}) has no parent as defined by the meta.`
      ),
      { silent }
    );
    process.exit(1);
  }
  return parent;
}