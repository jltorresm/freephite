import type { CommitMessageFields } from "../CommitInfoView/CommitMessageFields";
import type {
  ApplyPreviewsFuncType,
  ApplyUncommittedChangesPreviewsFuncType,
  PreviewContext,
  UncommittedChangesPreviewContext,
} from "../previews";

import { Operation } from "./Operation";

export class AmendOperation extends Operation {
  /**
   * @param filePathsToAmend if provided, only these file paths will be included in the amend operation. If undefined, ALL uncommitted changes are included. Paths should be relative to repo root.
   * @param message if provided, update commit description to use this title & description
   */
  constructor(
    private method: "commit" | "amend",
    private message?: CommitMessageFields
  ) {
    super("AmendOperation");
  }

  static opName = "Amend";

  getArgs() {
    if (this.method === "commit") {
      return [
        "commit",
        "create",
        "-m",
        this.message?.title || "Untitled commit",
      ];
    }

    const title = this.message?.title;

    return ["commit", "amend", ...(title ? ["-m", title] : ["-n"])];
  }

  makeOptimisticUncommittedChangesApplier?(
    context: UncommittedChangesPreviewContext
  ): ApplyUncommittedChangesPreviewsFuncType | undefined {
    if (context.uncommittedChanges.length === 0) {
      return undefined;
    }

    const func: ApplyUncommittedChangesPreviewsFuncType = () => {
      return [];
    };
    return func;
  }

  // optimistic state is only minorly useful for amend:
  // we just need it to update the head commit's title/description
  makeOptimisticApplier(
    context: PreviewContext
  ): ApplyPreviewsFuncType | undefined {
    const head = context.headCommit;
    if (this.message == null) {
      return undefined;
    }
    const { title, description } = this.message;
    if (head?.title === title && head?.description === description) {
      // amend succeeded when the message is what we asked for
      return undefined;
    }

    const func: ApplyPreviewsFuncType = (tree, _previewType) => {
      if (tree.info.isHead) {
        if (!this.message) {
          throw new Error("Missing message");
        }

        // use fake title/description on the head commit
        return {
          // TODO: we should also update `filesSample` after amending.
          // These files are visible in the commit info view during optimistic state.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          info: {
            ...tree.info,
            title,
            description: description ?? "",
          },
          children: tree.children,
        };
      } else {
        return { info: tree.info, children: tree.children };
      }
    };
    return func;
  }
}
