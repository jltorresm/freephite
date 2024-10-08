import type { BranchName } from "@withgraphite/gti-cli-shared-types";
import type { CommandArg } from "@withgraphite/gti-shared";
import type { CommitTree } from "../getCommitTree";
import type {
  ApplyPreviewsFuncType,
  ApplyUncommittedChangesPreviewsFuncType,
  PreviewContext,
  UncommittedChangesPreviewContext,
} from "../previews";

import type { CommitMessageFields } from "../CommitInfoView/CommitMessageFields";
import { Operation } from "./Operation";

export class CommitOperation extends Operation {
  /**
   * @param message the commit message. The first line is used as the title.
   * @param originalHeadHash the hash of the current head commit, needed to track when optimistic state is resolved.
   * @param filesPathsToCommit if provided, only these file paths will be included in the commit operation. If undefined, ALL uncommitted changes are included. Paths should be relative to repo root.
   */
  constructor(
    /**
     * description is currently ignored
     */
    private message: CommitMessageFields,
    private originalHeadHash: BranchName
  ) {
    super("CommitOperation");
  }

  static opName = "Commit";

  getArgs() {
    const args: Array<CommandArg> = [
      "branch",
      "create",
      "--message",
      `${this.message.title.split(/\n+/, 1)}`,
    ];
    return args;
  }

  makeOptimisticApplier(
    context: PreviewContext
  ): ApplyPreviewsFuncType | undefined {
    const head = context.headCommit;
    if (head?.branch !== this.originalHeadHash) {
      // commit succeeded when we no longer see the original head hash
      return undefined;
    }

    const title = this.message.title;
    const description = this.message.description;

    const optimistic_branch_name = title.toLocaleLowerCase();

    // TODO: we should include the files that will be in the commit.
    // These files are visible in the commit info view during optimistic state.

    const optimisticCommit: CommitTree = {
      children: [],
      info: {
        author: head?.author ?? "",
        description: description,
        title: title,
        isHead: true,
        parents: [head?.branch ?? ""],
        branch: optimistic_branch_name,
        partOfTrunk: false,
        date: new Date().toISOString(),
        needsRestack: false,
        needsSubmit: true,
      },
    };
    const func: ApplyPreviewsFuncType = (tree, _previewType) => {
      if (tree.info.branch === this.originalHeadHash) {
        // insert fake commit as a child of the old head
        return {
          info: { ...tree.info, isHead: false }, // overwrite previous head as no longer being head
          children: [...tree.children, optimisticCommit],
        };
      } else {
        return { info: tree.info, children: tree.children };
      }
    };
    return func;
  }

  makeOptimisticUncommittedChangesApplier?(
    context: UncommittedChangesPreviewContext
  ): ApplyUncommittedChangesPreviewsFuncType | undefined {
    // optimistic state is over when there's no uncommitted changes that we wanted to commit left
    if (context.uncommittedChanges.length === 0) {
      return undefined;
    }

    const func: ApplyUncommittedChangesPreviewsFuncType = () => {
      return [];
    };
    return func;
  }
}
