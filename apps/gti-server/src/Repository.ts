import type {
  AbsolutePath,
  CodeReviewSystem,
  CommandArg,
  Disposable,
  FetchedCommits,
  FetchedUncommittedChanges,
  MergeConflicts,
  OperationCommandProgressReporter,
  OperationProgress,
  PageVisibility,
  RepoInfo,
  RunnableOperation,
  SmartlogCommits,
  SuccessorInfo,
  ValidatedRepoInfo,
} from "@withgraphite/gti-shared";
import type { Logger } from "@withgraphite/gti-shared";

import type {
  BranchInfo,
  PRNumber,
  RepoRelativePath,
  Status,
  RepoInfo as RepoInfoFromCLI,
} from "@withgraphite/gti-cli-shared-types";
import { Comparison, ComparisonType } from "@withgraphite/gti-shared";
import { exists, removeLeadingPathSep } from "./fs";
import { RateLimiter } from "@withgraphite/gti-shared";
import { TypedEventEmitter } from "@withgraphite/gti-shared";
import { notEmpty, unwrap } from "@withgraphite/gti-shared";
import { CommandRunner } from "@withgraphite/gti-shared";
import execa from "execa";
import path from "path";
import type { ServerSideTracker } from "./analytics/serverSideTracker";
import {
  DEFAULT_DAYS_OF_COMMITS_TO_LOAD,
  ErrorShortMessages,
} from "@withgraphite/gti-shared";
import { GitHubCodeReviewProvider } from "./github/githubCodeReviewProvider";
import { OperationQueue } from "./OperationQueue";
import { PageFocusTracker } from "./PageFocusTracker";
import { handleAbortSignalOnProcess, serializeAsyncCall } from "./utils";
import { WatchForChanges } from "./WatchForChanges";
import semver from "semver";

export const COMMIT_END_MARK = "<<COMMIT_END_MARK>>";
export const NULL_CHAR = "\0";
const MAX_SIMULTANEOUS_CAT_CALLS = 4;

const MIN_REQUIRED_CLI_VERSION = "0.20.23";

type ConflictFileData = {
  contents: string;
  exists: boolean;
  isexec: boolean;
  issymlink: boolean;
};
export type ResolveCommandConflictOutput = [
  | {
      command: null;
      conflicts: [];
      pathconflicts: [];
    }
  | {
      command: string;
      command_details: { cmd: string; to_abort: string; to_continue: string };
      conflicts: Array<{
        base: ConflictFileData;
        local: ConflictFileData;
        output: ConflictFileData;
        other: ConflictFileData;
        path: string;
      }>;
      pathconflicts: Array<never>;
    }
];

/**
 * This class is responsible for providing information about the working copy
 * for a Graphite repository.
 *
 * A Repository may be reused by multiple connections, not just one GTI window.
 * This is so we don't duplicate watchman subscriptions and calls to status/log.
 * A Repository does not have a pre-defined `cwd`, so it may be re-used across cwds.
 *
 * Prefer using `RepositoryCache.getOrCreate()` to access and dispose `Repository`s.
 */
export class Repository {
  public IGNORE_COMMIT_MESSAGE_LINES_REGEX = /^((?:HG|SL):.*)/gm;

  private mergeConflicts: MergeConflicts | undefined = undefined;
  private uncommittedChanges: FetchedUncommittedChanges | null = null;
  private smartlogCommits: FetchedCommits | null = null;

  private mergeConflictsEmitter = new TypedEventEmitter<
    "change",
    MergeConflicts | undefined
  >();
  private uncommittedChangesEmitter = new TypedEventEmitter<
    "change",
    FetchedUncommittedChanges
  >();
  private smartlogCommitsChangesEmitter = new TypedEventEmitter<
    "change",
    FetchedCommits
  >();

  private smartlogCommitsBeginFetchingEmitter = new TypedEventEmitter<
    "start",
    undefined
  >();
  private uncommittedChangesBeginFetchingEmitter = new TypedEventEmitter<
    "start",
    undefined
  >();

  private disposables: Array<() => void> = [
    () => this.mergeConflictsEmitter.removeAllListeners(),
    () => this.uncommittedChangesEmitter.removeAllListeners(),
    () => this.smartlogCommitsChangesEmitter.removeAllListeners(),
    () => this.smartlogCommitsBeginFetchingEmitter.removeAllListeners(),
    () => this.uncommittedChangesBeginFetchingEmitter.removeAllListeners(),
  ];
  public onDidDispose(callback: () => unknown): void {
    this.disposables.push(callback);
  }

  private operationQueue: OperationQueue;
  private watchForChanges: WatchForChanges;
  private pageFocusTracker = new PageFocusTracker();
  public codeReviewProvider?: GitHubCodeReviewProvider;

  private currentVisibleCommitRangeIndex = 0;
  private visibleCommitRanges: Array<number | undefined> = [
    DEFAULT_DAYS_OF_COMMITS_TO_LOAD,
    60,
    undefined,
  ];

  /**  Prefer using `RepositoryCache.getOrCreate()` to access and dispose `Repository`s. */
  constructor(public info: ValidatedRepoInfo, public logger: Logger) {
    const remote = info.codeReviewSystem;
    if (remote.type === "github") {
      this.codeReviewProvider = new GitHubCodeReviewProvider(
        remote,
        this.runCommand.bind(this)
      );
    }

    this.watchForChanges = new WatchForChanges(
      info,
      logger,
      this.pageFocusTracker,
      (kind) => {
        if (kind === "uncommitted changes") {
          void this.fetchUncommittedChanges();
        } else if (kind === "commits") {
          void this.fetchSmartlogCommits();
        } else if (kind === "merge conflicts") {
          void this.checkForMergeConflicts();
        } else if (kind === "everything") {
          void this.fetchUncommittedChanges();
          void this.fetchSmartlogCommits();
          void this.checkForMergeConflicts();

          this.codeReviewProvider?.triggerDiffSummariesFetch(
            // We could choose to only fetch the diffs that changed (`newDiffs`) rather than all diffs,
            // but our UI doesn't cache old values, thus all other diffs would appear empty
            this.getAllDiffIds()
          );
        }
      }
    );

    this.operationQueue = new OperationQueue(
      this.logger,
      (
        operation: RunnableOperation,
        cwd: string,
        handleCommandProgress,
        signal: AbortSignal
      ): Promise<void> => {
        if (operation.runner === CommandRunner.Graphite) {
          return this.runOperation(
            operation,
            handleCommandProgress,
            cwd,
            signal
          );
        } else if (operation.runner === CommandRunner.CodeReviewProvider) {
          const normalizedArgs = this.normalizeOperationArgs(
            cwd,
            operation.args
          );

          if (this.codeReviewProvider?.runExternalCommand == null) {
            return Promise.reject(
              Error(
                "CodeReviewProvider does not support running external commands"
              )
            );
          }

          return (
            this.codeReviewProvider?.runExternalCommand(
              cwd,
              normalizedArgs,
              handleCommandProgress,
              signal
            ) ?? Promise.resolve()
          );
        }
        return Promise.resolve();
      }
    );

    // refetch summaries whenever we see new diffIds
    const seenDiffs = new Set();
    const subscription = this.subscribeToSmartlogCommitsChanges((fetched) => {
      if (fetched.commits.value) {
        const newDiffs = [];
        const diffIds = fetched.commits.value
          .filter((commit) => commit.pr)
          .map((commit) => commit.pr?.number);
        for (const diffId of diffIds) {
          if (!seenDiffs.has(diffId)) {
            newDiffs.push(diffId);
            seenDiffs.add(diffId);
          }
        }
        if (newDiffs.length > 0) {
          this.codeReviewProvider?.triggerDiffSummariesFetch(
            // We could choose to only fetch the diffs that changed (`newDiffs`) rather than all diffs,
            // but our UI doesn't cache old values, thus all other diffs would appear empty
            this.getAllDiffIds()
          );
        }
      }
    });

    // the repo may already be in a conflict state on startup
    void this.checkForMergeConflicts();

    this.disposables.push(() => subscription.dispose());
  }

  public nextVisibleCommitRangeInDays(): number | undefined {
    if (
      this.currentVisibleCommitRangeIndex + 1 <
      this.visibleCommitRanges.length
    ) {
      this.currentVisibleCommitRangeIndex++;
    }
    return this.visibleCommitRanges[this.currentVisibleCommitRangeIndex];
  }

  /**
   * Typically, disposing is handled by `RepositoryCache` and not used directly.
   */
  public dispose() {
    this.disposables.forEach((dispose) => dispose());
    this.codeReviewProvider?.dispose();
    this.watchForChanges.dispose();
  }

  public onChangeConflictState(
    callback: (conflicts: MergeConflicts | undefined) => unknown
  ): Disposable {
    this.mergeConflictsEmitter.on("change", callback);

    if (this.mergeConflicts) {
      // if we're already in merge conflicts, let the client know right away
      callback(this.mergeConflicts);
    }

    return {
      dispose: () => this.mergeConflictsEmitter.off("change", callback),
    };
  }

  public checkForMergeConflicts = serializeAsyncCall(async () => {
    this.logger.info("checking for merge conflicts");
    // Fast path: check if .git/merge dir changed
    const wasAlreadyInConflicts = this.mergeConflicts != null;
    if (!wasAlreadyInConflicts) {
      const mergeDirExists = await exists(
        path.join(this.info.dotdir, "rebase-merge")
      );
      if (!mergeDirExists) {
        // Not in a conflict
        this.logger.info(
          `conflict state still the same (${
            wasAlreadyInConflicts ? "IN merge conflict" : "NOT in conflict"
          })`
        );
        return;
      }
    }

    if (this.mergeConflicts == null) {
      // notify UI that merge conflicts were detected and full details are loading
      this.mergeConflicts = { state: "loading" };
      this.mergeConflictsEmitter.emit("change", this.mergeConflicts);
    }

    // More expensive full check for conflicts. Necessary if we see .gt/merge change, or if
    // we're already in a conflict and need to re-check if a conflict was resolved.

    const fetchStartTimestamp = Date.now();
    let output: Status;
    try {
      const proc = await this.runCommand(["internal-only", "status"]);
      output = JSON.parse(proc.stdout) as Status;
    } catch (err) {
      this.logger.error(`failed to check for merge conflicts: ${err}`);
      // To avoid being stuck in "loading" state forever, let's pretend there's no conflicts.
      this.mergeConflicts = undefined;
      this.mergeConflictsEmitter.emit("change", this.mergeConflicts);
      return;
    }

    this.mergeConflicts = computeNewConflicts(
      this.mergeConflicts,
      output,
      fetchStartTimestamp
    );
    this.logger.info(
      `repo ${this.mergeConflicts ? "IS" : "IS NOT"} in merge conflicts`
    );
    if (this.mergeConflicts) {
      const maxConflictsToLog = 20;
      const remainingConflicts = (this.mergeConflicts.files ?? [])
        .filter((conflict) => conflict.status === "UNRESOLVED")
        .map((conflict) => conflict.path)
        .slice(0, maxConflictsToLog);
      this.logger.info("remaining files with conflicts: ", remainingConflicts);
    }
    this.mergeConflictsEmitter.emit("change", this.mergeConflicts);
  });

  public getMergeConflicts(): MergeConflicts | undefined {
    return this.mergeConflicts;
  }

  /**
   * Determine basic repo info including the root and important config values.
   * Resulting RepoInfo may have null fields if cwd is not a valid repo root.
   * Throws if `command` is not found.
   */
  static async getRepoInfo(
    command: string,
    logger: Logger,
    cwd: string
  ): Promise<RepoInfo> {
    const repoVersion = await findVersion(command, logger, cwd).catch(
      (err: Error) => err
    );
    if (repoVersion instanceof Error) {
      return { type: "invalidCommand", command };
    }
    if (
      repoVersion !== "local" &&
      semver.lt(repoVersion, MIN_REQUIRED_CLI_VERSION)
    ) {
      return {
        type: "invalidVersion",
        command,
        versionFound: repoVersion,
        versionRequired: MIN_REQUIRED_CLI_VERSION,
      };
    }

    const [profile, repoInfoRaw, preferredBranchEdit] = await Promise.all([
      findRepoProfile(command, logger, cwd),
      findRepoInfo(command, logger, cwd),
      getConfig(command, logger, cwd, "graphite.branch_edit").then(
        (value) => (value as "commit" | "amend") ?? ("amend" as const)
      ),
    ]);
    if (repoInfoRaw == null) {
      return { type: "cwdNotARepository", cwd };
    }

    let codeReviewSystem: CodeReviewSystem;
    if (typeof repoInfoRaw.remote === "undefined") {
      codeReviewSystem = { type: "none" };
    } else {
      const { owner, name, hostname } = repoInfoRaw.remote;
      codeReviewSystem = {
        type: "github",
        owner,
        repo: name,
        hostname,
      };
    }

    const result: RepoInfo = {
      type: "success",
      command,
      dotdir: repoInfoRaw.dotDir,
      repoRoot: repoInfoRaw.rootDir,
      codeReviewSystem,
      preferredBranchEdit,
      profile,
      trunkBranch: repoInfoRaw.trunkBranch,
    };
    logger.info("repo info: ", result);
    return result;
  }

  /**
   * Run long-lived command which mutates the repository state.
   * Progress is streamed back as it comes in.
   * Operations are run immediately. For queueing, see OperationQueue.
   */
  async runOrQueueOperation(
    operation: RunnableOperation,
    onProgress: (progress: OperationProgress) => void,
    tracker: ServerSideTracker,
    cwd: string
  ): Promise<void> {
    await this.operationQueue.runOrQueueOperation(
      operation,
      onProgress,
      tracker,
      cwd
    );

    // After any operation finishes, make sure we poll right away,
    // so the UI is guarnateed to get the latest data.
    this.watchForChanges.poll("force");
  }

  /**
   * Abort the running operation if it matches the given id.
   */
  abortRunningOpeation(operationId: string) {
    this.operationQueue.abortRunningOperation(operationId);
  }

  /**
   * Called by this.operationQueue in response to runOrQueueOperation when an operation is ready to actually run.
   */
  private normalizeOperationArgs(
    cwd: string,
    args: Array<CommandArg>
  ): Array<string> {
    const repoRoot = unwrap(this.info.repoRoot);

    return args.map((arg) => {
      if (typeof arg === "object") {
        switch (arg.type) {
          case "repo-relative-file":
            return path.normalize(
              path.relative(cwd, path.join(repoRoot, arg.path))
            );
          case "succeedable-revset":
            return `max(successors(${arg.revset}))`;
        }
      }
      return arg;
    });
  }

  /**
   * Called by this.operationQueue in response to runOrQueueOperation when an operation is ready to actually run.
   */
  private async runOperation(
    operation: {
      id: string;
      args: Array<CommandArg>;
      stdin?: string;
    },
    onProgress: OperationCommandProgressReporter,
    cwd: string,
    signal: AbortSignal
  ): Promise<void> {
    const cwdRelativeArgs = this.normalizeOperationArgs(cwd, operation.args);
    const { stdin } = operation;
    const { command, args, options } = getExecParams(
      this.info.command,
      cwdRelativeArgs,
      cwd,
      stdin ? { input: stdin } : undefined
    );

    this.logger.log("run operation: ", command, cwdRelativeArgs.join(" "));

    const execution = execa(command, args, {
      ...options,
      stdout: "pipe",
      stderr: "pipe",
    });
    // It would be more appropriate to call this in reponse to execution.on('spawn'), but
    // this seems to be inconsistent about firing in all versions of node.
    // Just send spawn immediately. Errors during spawn like ENOENT will still be reported by `exit`.
    onProgress("spawn");
    execution.stdout?.on("data", (data) => {
      onProgress("stdout", data.toString());
    });
    execution.stderr?.on("data", (data) => {
      onProgress("stderr", data.toString());
    });
    void execution.on("exit", (exitCode) => {
      onProgress("exit", exitCode || 0);
    });
    signal.addEventListener("abort", () => {
      this.logger.log("kill operation: ", command, cwdRelativeArgs.join(" "));
    });
    handleAbortSignalOnProcess(execution, signal);
    await execution;
  }

  setPageFocus(page: string, state: PageVisibility) {
    this.pageFocusTracker.setState(page, state);
  }

  /** Return the latest fetched value for UncommittedChanges. */
  getUncommittedChanges(): FetchedUncommittedChanges | null {
    return this.uncommittedChanges;
  }

  subscribeToUncommittedChanges(
    callback: (result: FetchedUncommittedChanges) => unknown
  ): Disposable {
    this.uncommittedChangesEmitter.on("change", callback);
    return {
      dispose: () => {
        this.uncommittedChangesEmitter.off("change", callback);
      },
    };
  }

  fetchUncommittedChanges = serializeAsyncCall(async () => {
    const fetchStartTimestamp = Date.now();
    try {
      this.uncommittedChangesBeginFetchingEmitter.emit("start");
      const proc = await this.runCommand(["internal-only", "status"]);
      const files = (JSON.parse(proc.stdout) as Status).files.map((change) => ({
        ...change,
        path: removeLeadingPathSep(change.path),
      }));

      this.uncommittedChanges = {
        fetchStartTimestamp,
        fetchCompletedTimestamp: Date.now(),
        files: { value: files },
      };
      this.uncommittedChangesEmitter.emit("change", this.uncommittedChanges);
    } catch (err) {
      this.logger.error("Error fetching files: ", err);
      if (isProcessError(err)) {
        if (err.stderr.includes("checkout is currently in progress")) {
          this.logger.info(
            "Ignoring `hg status` error caused by in-progress checkout"
          );
          return;
        }
      }
      // emit an error, but don't save it to this.uncommittedChanges
      this.uncommittedChangesEmitter.emit("change", {
        fetchStartTimestamp,
        fetchCompletedTimestamp: Date.now(),
        files: { error: err instanceof Error ? err : new Error(err as string) },
      });
    }
  });

  /** Return the latest fetched value for SmartlogCommits. */
  getSmartlogCommits(): FetchedCommits | null {
    return this.smartlogCommits;
  }

  subscribeToSmartlogCommitsChanges(
    callback: (result: FetchedCommits) => unknown
  ) {
    this.smartlogCommitsChangesEmitter.on("change", callback);
    return {
      dispose: () => {
        this.smartlogCommitsChangesEmitter.off("change", callback);
      },
    };
  }

  subscribeToSmartlogCommitsBeginFetching(
    callback: (isFetching: boolean) => unknown
  ) {
    const onStart = () => callback(true);
    this.smartlogCommitsBeginFetchingEmitter.on("start", onStart);
    return {
      dispose: () => {
        this.smartlogCommitsBeginFetchingEmitter.off("start", onStart);
      },
    };
  }

  subscribeToUncommittedChangesBeginFetching(
    callback: (isFetching: boolean) => unknown
  ) {
    const onStart = () => callback(true);
    this.uncommittedChangesBeginFetchingEmitter.on("start", onStart);
    return {
      dispose: () => {
        this.uncommittedChangesBeginFetchingEmitter.off("start", onStart);
      },
    };
  }

  fetchSmartlogCommits = serializeAsyncCall(async () => {
    const fetchStartTimestamp = Date.now();
    try {
      this.smartlogCommitsBeginFetchingEmitter.emit("start");
      const proc = await this.runCommand(["internal-only", "log"]);
      const commits = parseCommitInfoOutput(this.logger, proc.stdout.trim());
      if (commits.length === 0) {
        throw new Error(ErrorShortMessages.NoCommitsFetched);
      }
      this.smartlogCommits = {
        fetchStartTimestamp,
        fetchCompletedTimestamp: Date.now(),
        commits: { value: commits },
      };
      this.smartlogCommitsChangesEmitter.emit("change", this.smartlogCommits);
    } catch (err) {
      this.logger.error("Error fetching commits: ", err);
      this.smartlogCommitsChangesEmitter.emit("change", {
        fetchStartTimestamp,
        fetchCompletedTimestamp: Date.now(),
        commits: {
          error: err instanceof Error ? err : new Error(err as string),
        },
      });
    }
  });

  /** Watch for changes to the head commit, e.g. from checking out a new commit */
  subscribeToHeadCommit(callback: (head: BranchInfo) => unknown) {
    let headCommit = this.smartlogCommits?.commits.value?.find(
      (commit) => commit.isHead
    );
    if (headCommit != null) {
      callback(headCommit);
    }
    const onData = (data: FetchedCommits) => {
      const newHead = data?.commits.value?.find((commit) => commit.isHead);
      if (newHead != null && newHead.branch !== headCommit?.branch) {
        callback(newHead);
        headCommit = newHead;
      }
    };
    this.smartlogCommitsChangesEmitter.on("change", onData);
    return {
      dispose: () => {
        this.smartlogCommitsChangesEmitter.off("change", onData);
      },
    };
  }

  private catLimiter = new RateLimiter(MAX_SIMULTANEOUS_CAT_CALLS, (s) =>
    this.logger.info("[cat]", s)
  );
  /** Return file content at a given revset, e.g. hash or `.` */
  public cat(file: AbsolutePath, comparison: Comparison): Promise<string> {
    const relativePath = path.relative(this.info.repoRoot, file);

    return this.catLimiter.enqueueRun(async () => {
      // For `gt cat`, we want the output of the command verbatim.
      const options = { stripFinalNewline: false };
      return (
        await this.runCommand(
          [
            "internal-only",
            "relative-cat",
            ...this.catArgs(comparison, relativePath),
          ],
          /*cwd=*/ undefined,
          options
        )
      ).stdout;
    });
  }

  private catArgs(comparison: Comparison, file: string): Array<string> {
    switch (comparison.type) {
      case ComparisonType.UncommittedChanges:
        return ["uncommitted", file];
      case ComparisonType.HeadChanges:
        return ["head", file];
      case ComparisonType.StackChanges:
        return ["stack", file];
      case ComparisonType.Committed:
        return ["stack", file, "--ref", comparison.hash];
    }
  }

  public getAllDiffIds(): Array<PRNumber> {
    return (
      this.getSmartlogCommits()
        ?.commits.value?.map((commit) => commit.pr?.number)
        .filter(notEmpty) ?? []
    );
  }

  public runCommand(
    args: Array<string>,
    cwd?: string,
    options?: execa.Options
  ): execa.ExecaChildProcess<string> {
    return runCommand({
      command: this.info.command,
      args,
      logger: this.logger,
      cwd: unwrap(cwd ?? this.info.repoRoot),
      options,
    });
  }

  public getConfig(configName: string): Promise<string | undefined> {
    return getConfig(
      this.info.command,
      this.logger,
      this.info.repoRoot,
      configName
    );
  }
  public setConfig(
    level: ConfigLevel,
    configName: string,
    configValue: string
  ): Promise<void> {
    return setConfig(
      this.info.command,
      this.logger,
      this.info.repoRoot,
      level,
      configName,
      configValue
    );
  }
}

export function runCommand({
  command: command_,
  args: args_,
  logger,
  cwd,
  options: options_,
}: {
  command: string;
  args: Array<string>;
  logger?: Logger;
  cwd: string;
  options?: execa.Options;
}): execa.ExecaChildProcess {
  const { command, args, options } = getExecParams(
    command_,
    args_,
    cwd,
    options_
  );
  if (logger) {
    logger.log("run command: ", command, ...args);
  }
  return execa(command, args, options);
}

async function findVersion(
  command: string,
  logger: Logger,
  cwd: string
): Promise<string> {
  try {
    return (
      await runCommand({
        command,
        args: ["--version"],
        logger,
        cwd,
      })
    ).stdout;
  } catch (error) {
    logger.error(`Failed to find gt version in ${cwd}`, error);
    throw error;
  }
}

async function findRepoInfo(
  command: string,
  logger: Logger,
  cwd: string
): Promise<RepoInfoFromCLI | undefined> {
  try {
    return JSON.parse(
      (
        await runCommand({
          command,
          args: ["internal-only", "repo-info"],
          logger,
          cwd,
        })
      ).stdout
    );
  } catch (error) {
    logger.error(`Failed to find repository info in ${cwd}`, error);
    return undefined;
  }
}

async function findRepoProfile(
  command: string,
  logger: Logger,
  cwd: string
): Promise<{
  appUrl: string;
}> {
  try {
    return JSON.parse(
      (
        await runCommand({
          command,
          args: ["internal-only", "profile"],
          logger,
          cwd,
        })
      ).stdout
    );
  } catch (error) {
    logger.error(`Failed to find repository profile in ${cwd}`, error);
    return {
      appUrl: "https://app.graphite.dev/",
    };
  }
}

async function getConfig(
  command: string,
  logger: Logger,
  cwd: string,
  configName: string
): Promise<string | undefined> {
  try {
    return (
      await runCommand({
        command,
        args: ["internal-only", "config", configName],
        logger,
        cwd,
      })
    ).stdout.trim();
  } catch {
    // `config` exits with status 1 if config is not set. This is not an error.
    return undefined;
  }
}

// Eventually add repo
type ConfigLevel = "user";
async function setConfig(
  command: string,
  logger: Logger,
  cwd: string,
  level: ConfigLevel,
  configName: string,
  configValue: string
): Promise<void> {
  await runCommand({
    command,
    args: [
      "internal-only",
      "set-config",
      `--level`,
      level,
      configName,
      configValue,
    ],
    logger,
    cwd,
  });
}

function getExecParams(
  command: string,
  args_: Array<string>,
  cwd: string,
  options_?: execa.Options
): {
  command: string;
  args: Array<string>;
  options: execa.Options;
} {
  let args = [...args_];
  // expandHomeDir is not supported on windows
  if (process.platform !== "win32") {
    // commit/amend have unconventional ways of escaping slashes from messages.
    // We have to 'unescape' to make it work correctly.
    args = args.map((arg) => arg.replace(/\\\\/g, "\\"));
  }
  const options = {
    ...options_,
    env: {
      LANG: "en_US.utf-8", // make sure to use unicode if user hasn't set LANG themselves
      EDITOR: undefined,
      GRAPHITE_INTERACTIVE: "true",
    },
    cwd,
  };

  // TODO: we could run with systemd for better OOM protection when on linux
  return { command, args, options };
}

/**
 * Extract CommitInfos from log calls that use FETCH_TEMPLATE.
 */
export function parseCommitInfoOutput(
  logger: Logger,
  output: string
): SmartlogCommits {
  let commitInfos: Array<BranchInfo> = [];
  try {
    commitInfos = JSON.parse(output);
  } catch (err) {
    logger.error("failed to parse commit");
  }
  return commitInfos;
}
export function parseSuccessorData(
  successorData: string
): SuccessorInfo | undefined {
  const [successorString] = successorData.split(",", 1); // we're only interested in the first available mutation
  if (!successorString) {
    return undefined;
  }
  const successor = successorString.split(":");
  return {
    hash: successor[1],
    type: successor[0],
  };
}

/**
 * Returns absolute path for a repo-relative file path.
 * If the path "escapes" the repository's root dir, returns null
 * Used to validate that a file path does not "escape" the repo, and the file can safely be modified on the filesystem.
 * absolutePathForFileInRepo("foo/bar/file.txt", repo) -> /path/to/repo/foo/bar/file.txt
 * absolutePathForFileInRepo("../file.txt", repo) -> null
 */
export function absolutePathForFileInRepo(
  filePath: RepoRelativePath,
  repo: Repository,
  pathMod = path
): AbsolutePath | null {
  // Note that resolve() is contractually obligated to return an absolute path.
  const fullPath = pathMod.resolve(repo.info.repoRoot, filePath);
  // Prefix checks on paths can be footguns on Windows for C:\\ vs c:\\, but since
  // we use the same exact path check here and in the resolve, there should be
  // no incompatibility here.
  if (fullPath.startsWith(repo.info.repoRoot + pathMod.sep)) {
    return fullPath;
  } else {
    return null;
  }
}

export function repoRelativePathForAbsolutePath(
  absolutePath: AbsolutePath,
  repo: Repository,
  pathMod = path
): RepoRelativePath {
  return pathMod.relative(repo.info.repoRoot, absolutePath);
}

function isProcessError(s: unknown): s is { stderr: string } {
  return s != null && typeof s === "object" && "stderr" in s;
}

function computeNewConflicts(
  previousConflicts: MergeConflicts,
  commandOutput: Status,
  fetchStartTimestamp: number
): MergeConflicts | undefined {
  const newConflictData = commandOutput;
  if (!newConflictData?.conflicts) {
    return undefined;
  }

  const newConflicts = newConflictData.files.filter(
    (file) => file.status === "UNRESOLVED"
  );
  const conflicts: MergeConflicts = {
    state: "loaded",
    files: [],
    fetchStartTimestamp,
    fetchCompletedTimestamp: Date.now(),
  };
  if (previousConflicts?.files != null && previousConflicts.files.length > 0) {
    // we saw conflicts before, some of which might now be resolved. Preserve previous ordering.
    const newConflictSet = new Set(
      newConflicts.map((conflict) => conflict.path)
    );
    conflicts.files = previousConflicts.files.map((conflict) =>
      newConflictSet.has(conflict.path)
        ? { path: conflict.path, status: "UNRESOLVED" }
        : // 'R' is overloaded to mean "removed" for `gt status` but 'Resolved' for `gt resolve --list`
          // let's re-write this to make the UI layer simpler.
          { path: conflict.path, status: "RESOLVED" }
    );
  } else {
    conflicts.files = newConflicts.map((conflict) => ({
      path: conflict.path,
      status: "UNRESOLVED",
    }));
  }

  return conflicts;
}
