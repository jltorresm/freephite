import type {
  BranchInfo,
  BranchName,
  ChangedFiles,
  ChangedFile,
  RepoRelativePath,
} from "@withgraphite/gti-cli-shared-types";

import type { TypeaheadKind, TypeaheadResult } from "./commit_info_view";

import type { ThemeColor } from "../theme";

import type { LazyExoticComponent } from "react";
import type { TrackEventName } from "../analytics/eventNames";
import type { GitHubDiffSummary } from "./githubCodeReviewProvider";
import type { TrackDataWithEventName } from "../analytics/types";
import type { Hash } from "./common";
import type { AllUndefined, Json } from "../typeUtils";
import type { Comparison } from "../Comparison";
export type Result<T> =
  | { value: T; error?: undefined }
  | { value?: undefined; error: Error };

export type AbsolutePath = string;

/** known supported "Platforms" in which GTI may be embedded */
export type PlatformName = "browser" | "vscode";

/**
 * cwd may be a subdirectory of the repository root.
 * Some commands expect cwd-relative paths,
 * but we generally prefer {@link RepoRelativePaths} when possible. */
export type CwdRelativePath = string;

export type { Hash };

/** Revsets are an eden concept that let you specify commits.
 * This could be a Hash, '.' for HEAD, .^ for parent of head, etc. See `eden help revset` */
export type Revset = string;

/**
 * "Diff" means a unit of Code Review according to your remote repo provider
 * For GitHub, this is a "Pull Request"
 */

/**
 * Short info about a Diff fetched in bulk for all diffs to render an overview
 */
export type DiffSummary = GitHubDiffSummary;

/**
 * Summary of CI test results for a Diff.
 * 'pass' if ALL signals succeed and not still running.
 * 'failed' if ANY signal doesn't suceed, even if some are still running.
 */
export type DiffSignalSummary =
  | "running"
  | "pass"
  | "failed"
  | "warning"
  | "no-signal";

/**
 * Detailed info about a Diff fetched individually when looking at the details
 */
// TODO: export type DiffDetails = {};

/** An error causing the entire Repository to not be accessible */
export type RepositoryError =
  | {
      type: "invalidCommand";
      command: string;
    }
  | {
      type: "invalidVersion";
      versionFound: string;
      versionRequired: string;
      command: string;
    }
  | { type: "cwdNotARepository"; cwd: string }
  | {
      type: "unknownError";
      error: Error;
    };

export type RepoInfo = RepositoryError | ValidatedRepoInfo;

/** Proven valid repositories with valid repoRoot / dotdir */
export type ValidatedRepoInfo = {
  type: "success";
  /** Which cli command name this repository should use for graphite, e.g. `gt`  */
  command: string;
  /**
   * Repo root, which cwd may be a subset of. `undefined` if the cwd is not a valid repository.
   */
  repoRoot: AbsolutePath;
  /**
   * Directory containing gt internal information for this repo, usually `${repoRoot}/.git`.
   */
  dotdir: AbsolutePath;
  codeReviewSystem: CodeReviewSystem;
  preferredBranchEdit: "amend" | "commit";
  /**
   * Configuring this per repo; in the event where users have two accounts (one on a GHES instance
   * and one on a public instance), I imagine we would let them to configure GT auth per repo (perhaps
   * similar to profiles)... that seems like a better incremental path than supporting multiple
   * GH accounts per GT account.
   */
  profile: {
    appUrl: string;
  };

  trunkBranch: string;
};

export type CodeReviewSystem =
  | {
      type: "github";
      owner: string;
      repo: string;
      /** github enterprise may use a different hostname than 'github.com' */
      hostname: string;
    }
  | {
      type: "none";
    };

export type SuccessorInfo = {
  hash: string;
  type: string;
};

/**
 * Most arguments to eden commands are literal `string`s, except:
 * - When specifying file paths, the server needs to know which args are files to convert them to be cwd-relative.
 * - When specifying commit hashes, you may be acting on optimistic version of those hashes.
 *   The server can re-write hashes using a revset that transforms into the latest successor instead.
 *   This allows you to act on the optimistic versions of commits in queued commands,
 *   without a race with the server telling you new versions of those hashes.
 *   TODO: what if you WANT to act on an obsolete commit?
 */
export type CommandArg =
  | string
  | { type: "repo-relative-file"; path: RepoRelativePath }
  | { type: "succeedable-revset"; revset: Revset };

/**
 * What process to execute a given operation in, such as `gt`
 */
export enum CommandRunner {
  Graphite = "gt",
  /**
   * Use the configured Code Review provider to run this command,
   * such as a non-graphite external submit command
   */
  CodeReviewProvider = "codeReviewProvider",
}

/**
 * {@link CommandArg} representing a hash or revset which should be re-written
 * to the latest successor of that revset when being run.
 * This enables queued commands to act on optimistic state without knowing
 * the optimistic commit's hashes directly.
 */
export function SucceedableRevset(revset: Revset): CommandArg {
  return { type: "succeedable-revset", revset };
}

/* Subscriptions */

/**
 * A subscription allows the client to ask for a stream of events from the server.
 * The client may send subscribe and corresponding unsubscribe messages.
 * Subscriptions are indexed by a subscriptionId field.
 * Responses to subscriptions are of type Fetched<T>
 */
export type Subscribe<K extends string> =
  | { type: `subscribe${K}`; subscriptionID: string }
  | { type: `unsubscribe${K}`; subscriptionID: string };

/** Reponses to subscriptions, including data and the time duration the fetch lasted */
export type Fetched<K extends string, V> = {
  type: `fetched${K}`;
  subscriptionID: string;
} & V;

export type UncommittedChanges = Array<ChangedFile>;
export type FetchedUncommittedChanges = {
  files: Result<UncommittedChanges>;
  fetchStartTimestamp: number;
  fetchCompletedTimestamp: number;
};

export type BeganFetchingUncommittedChangesEvent = {
  type: "beganFetchingUncommittedChangesEvent";
};

export type SmartlogCommits = Array<BranchInfo>;
export type FetchedCommits = {
  commits: Result<SmartlogCommits>;
  fetchStartTimestamp: number;
  fetchCompletedTimestamp: number;
};

export type BeganFetchingSmartlogCommitsEvent = {
  type: "beganFetchingSmartlogCommitsEvent";
};

type ConflictInfo = {
  files: Array<ChangedFile>;
  fetchStartTimestamp: number;
  fetchCompletedTimestamp: number;
};
export type MergeConflicts =
  | ({ state: "loading" } & AllUndefined<ConflictInfo>)
  | ({
      state: "loaded";
    } & ConflictInfo);

/* Operations */

export type RunnableOperation = {
  args: Array<CommandArg>;
  id: string;
  stdin?: string | undefined;
  runner: CommandRunner;
  trackEventName: TrackEventName;
};

export type OperationProgress =
  // another operation is running, so this one has been queued to run. Also include full state of the queue.
  | { id: string; kind: "queue"; queue: Array<string> }
  // the server has started the process. This also servers as a "dequeue" notification. Also include full state of the queue.
  | { id: string; kind: "spawn"; queue: Array<string> }
  | { id: string; kind: "stderr"; message: string }
  | { id: string; kind: "stdout"; message: string }
  | { id: string; kind: "exit"; exitCode: number; timestamp: number }
  | { id: string; kind: "error"; error: string };

export type OperationCommandProgressReporter = (
  ...args:
    | ["spawn"]
    | ["stdout", string]
    | ["stderr", string]
    | ["exit", number]
) => void;

export type OperationProgressEvent = {
  type: "operationProgress";
} & OperationProgress;

/** A line number starting from 1 */
export type OneIndexedLineNumber = Exclude<number, 0>;

/* protocol */

/**
 * messages sent by platform-specific (browser, vscode, electron) implementations
 * to be handled uniquely per server type.
 */
export type PlatformSpecificClientToServerMessages =
  | {
      type: "platform/openFile";
      path: RepoRelativePath;
      options?: { line?: OneIndexedLineNumber };
    }
  | {
      type: "platform/openDiff";
      path: RepoRelativePath;
      comparison: Comparison;
    }
  | { type: "platform/openExternal"; url: string }
  | { type: "platform/confirm"; message: string; details?: string | undefined }
  | { type: "platform/subscribeToAvailableCwds" }
  | {
      type: "platform/setVSCodeConfig";
      config: string;
      value: Json | undefined;
      scope: "workspace" | "global";
    }
  | {
      type: "platform/executeVSCodeCommand";
      command: string;
      args: Array<Json>;
    }
  | { type: "platform/subscribeToVSCodeConfig"; config: string };

/**
 * messages returned by platform-specific (browser, vscode, electron) server implementation,
 * usually in response to a platform-specific ClientToServer message
 */
export type PlatformSpecificServerToClientMessages =
  | {
      type: "platform/confirmResult";
      result: boolean;
    }
  | {
      type: "platform/availableCwds";
      options: Array<AbsolutePath>;
    }
  | {
      type: "platform/vscodeConfigChanged";
      config: string;
      value: Json | undefined;
    };

export type PageVisibility = "focused" | "visible" | "hidden";

export type FileABugFields = {
  title: string;
  description: string;
  repro: string;
};
export type FileABugProgress =
  | { status: "starting" }
  | { status: "inProgress"; message: string }
  | { status: "success"; taskNumber: string; taskLink: string }
  | { status: "error"; error: Error };
export type FileABugProgressMessage = {
  type: "fileBugReportProgress";
} & FileABugProgress;

/**
 * Like ClientToServerMessage, but these messages will be followed
 * on the message bus by an additional binary ArrayBuffer payload message.
 */
export type ClientToServerMessageWithPayload = {
  type: "uploadFile";
  filename: string;
  id: string;
} & { hasBinaryPayload: true };

export type SubscriptionKind =
  | "uncommittedChanges"
  | "smartlogCommits"
  | "mergeConflicts";

export type ConfigName =
  // these config names are for compatibility.
  | "gti.submitAsDraft"
  | "gti.changedFilesDisplayType"
  | "gti.hasShownGettingStarted"
  // sapling config prefers foo-bar naming.
  | "gti.pull-button-choice"
  | "gti.experimental-features";

export type ClientToServerMessage =
  | {
      type: "refresh";
    }
  | {
      type: "fetchRepoMessage";
    }
  | {
      type: "fetchUpgradePrompt";
    }
  | { type: "getConfig"; name: ConfigName }
  | { type: "setConfig"; name: ConfigName; value: string }
  | { type: "changeCwd"; cwd: string }
  | { type: "track"; data: TrackDataWithEventName }
  | { type: "fileBugReport"; data: FileABugFields; uiState?: Json }
  | { type: "runOperation"; operation: RunnableOperation }
  | { type: "abortRunningOperation"; operationId: string }
  | { type: "deleteFile"; filePath: RepoRelativePath }
  | { type: "requestChangedFiles"; branch: string }
  | { type: "fetchCommitMessageTemplate" }
  | { type: "typeahead"; kind: TypeaheadKind; query: string; id: string }
  | { type: "requestRepoInfo" }
  | { type: "requestApplicationInfo" }
  | { type: "fetchDiffSummaries" }
  | { type: "pageVisibility"; state: PageVisibility }
  | {
      type: "requestComparison";
      comparison: Comparison;
    }
  | {
      type: "requestComparisonContextLines";
      id: {
        comparison: Comparison;
        path: RepoRelativePath;
      };
      start: number;
      numLines: number;
    }
  | { type: "loadMoreCommits" }
  | { type: "subscribe"; kind: SubscriptionKind; subscriptionID: string }
  | { type: "unsubscribe"; kind: SubscriptionKind; subscriptionID: string }
  | PlatformSpecificClientToServerMessages;

export type SubscriptionResultsData = {
  uncommittedChanges: FetchedUncommittedChanges;
  smartlogCommits: FetchedCommits;
  mergeConflicts: MergeConflicts | undefined;
};

export type SubscriptionResult<K extends SubscriptionKind> = {
  type: "subscriptionResult";
  subscriptionID: string;
  kind: K;
  data: SubscriptionResultsData[K];
};

export type ServerToClientMessage =
  | SubscriptionResult<"smartlogCommits">
  | SubscriptionResult<"uncommittedChanges">
  | SubscriptionResult<"mergeConflicts">
  | BeganFetchingSmartlogCommitsEvent
  | BeganFetchingUncommittedChangesEvent
  | FileABugProgressMessage
  | { type: "gotConfig"; name: ConfigName; value: string | undefined }
  | { type: "fetchedCommitMessageTemplate"; templates: Record<string, string> }
  | { type: "typeaheadResult"; id: string; result: Array<TypeaheadResult> }
  | { type: "applicationInfo"; platformName: string; version: string }
  | { type: "repoInfo"; info: RepoInfo; cwd?: string }
  | { type: "repoError"; error: RepositoryError | undefined }
  | {
      type: "fetchedDiffSummaries";
      summaries: Result<DiffSummary[]>;
    }
  | {
      type: "fetchedRepoMessage";
      message: string;
    }
  | {
      type: "fetchedUpgradePrompt";
      message: string;
    }
  | { type: "uploadFileResult"; id: string; result: Result<string> }
  | { type: "comparison"; comparison: Comparison; data: ComparisonData }
  | {
      type: "comparisonContextLines";
      path: RepoRelativePath;
      lines: Array<string>;
    }
  | { type: "beganLoadingMoreCommits" }
  | { type: "commitsShownRange"; rangeInDays: number | undefined }
  | { type: "additionalCommitAvailability"; moreAvailable: boolean }
  | { type: "changedFiles"; branch: BranchName; data: ChangedFiles }
  | OperationProgressEvent
  | PlatformSpecificServerToClientMessages;

export type Disposable = {
  dispose(): void;
};

export type ComparisonData = {
  diff: Result<string>;
};

export type InitialParamKeys = "token" | string;

/**
 * Platform-specific API for each target: vscode extension, electron standalone, browser, ...
 */
export interface Platform {
  platformName: PlatformName;
  confirm(message: string, details?: string): Promise<boolean>;
  openFile(
    path: RepoRelativePath,
    options?: { line?: OneIndexedLineNumber }
  ): void;
  openDiff?(path: RepoRelativePath, comparison: Comparison): void;
  openExternalLink(url: string): void;
  clipboardCopy(value: string): void;

  /**
   * Component representing additional buttons/info in the help menu.
   * Note: This should be lazy-loaded via `React.lazy()` so that implementations
   * may import any files without worrying about the platform being set up yet or not.
   */
  AdditionalDebugContent?: LazyExoticComponent<() => JSX.Element>;

  theme?: {
    getTheme(): ThemeColor;
    onDidChangeTheme(callback: (theme: ThemeColor) => unknown): Disposable;
  };
}
