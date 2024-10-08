import type { RepositoryError } from "@withgraphite/gti-shared";

import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import React from "react";
import { ContextMenus } from "./ContextMenu";
import { Drawers } from "./Drawers";
import { useThrottledEffect } from "./hooks";
import { Icon } from "./Icon";
import { tracker } from "./analytics";
import { CommandHistoryAndProgress } from "./CommandHistoryAndProgress";
import { CommitInfoSidebar } from "./CommitInfoView/CommitInfoView";
import { CommitTreeList } from "./CommitTreeList";
import { ComparisonViewModal } from "./ComparisonView/ComparisonViewModal";
import { EmptyState } from "./EmptyState";
import { ErrorBoundary, ErrorNotice } from "./ErrorNotice";
import { GettingStartedModal } from "./gettingStarted/GettingStartedModal";
import { useCommand } from "./GTIShortcuts";
import platform from "./platform";
import { useMainContentWidth } from "./responsive";
import { repositoryInfo } from "./serverAPIState";
import { ThemeRoot } from "./theme";
import { TopBar } from "./TopBar";
import { TopLevelErrors } from "./TopLevelErrors";
import { ModalContainer } from "./useModal";

import { GTICommandContext } from "./GTIShortcuts";
import "./index.scss";

import { action } from "mobx";
import { observer } from "mobx-react-lite";
import "./index.scss";
import { gtiDrawerState } from "./drawerState";
import { upgradePrompt } from "./upgradePrompt";
import { BannerNotice } from "./BannerNotice";

export default function App() {
  return (
    <React.StrictMode>
      <ThemeRoot>
        <GTICommandContext>
          <ErrorBoundary>
            <GTIDrawers />
            <div
              className="tooltip-root-container"
              data-testid="tooltip-root-container"
            />
            <GettingStartedModal />
            <ComparisonViewModal />
            <ModalContainer />
            <ContextMenus />
          </ErrorBoundary>
        </GTICommandContext>
      </ThemeRoot>
    </React.StrictMode>
  );
}

const GTIDrawers = observer(() => {
  useCommand(
    "ToggleSidebar",
    action(() => {
      const state = gtiDrawerState.get();
      gtiDrawerState.set({
        ...state,
        right: { ...state.right, collapsed: !state.right.collapsed },
      });
    })
  );

  return (
    <Drawers
      drawerState={gtiDrawerState}
      rightLabel={
        <>
          <Icon icon="edit" />
          <>Branch Info</>
        </>
      }
      right={<CommitInfoSidebar />}
      errorBoundary={ErrorBoundary}
    >
      <MainContent />
      <CommandHistoryAndProgress />
    </Drawers>
  );
});

const MainContent = observer(() => {
  const repoInfo = repositoryInfo.get();
  const upgradePromptValue = upgradePrompt.get();

  const ref = useMainContentWidth();

  return (
    <div className="main-content-area" ref={ref}>
      <TopBar />
      <TopLevelErrors />
      {upgradePromptValue ? <BannerNotice title={upgradePromptValue} /> : null}
      {repoInfo != null && repoInfo.type !== "success" ? (
        <GTINullState repoError={repoInfo} />
      ) : (
        <CommitTreeList />
      )}
    </div>
  );
});

const GTINullState = observer(
  ({ repoError }: { repoError: RepositoryError }) => {
    useThrottledEffect(
      () => {
        if (repoError != null) {
          switch (repoError.type) {
            case "cwdNotARepository":
              tracker.track("UIEmptyState", {
                extras: { cwd: repoError.cwd },
                errorName: "InvalidCwd",
              });
              break;
            case "invalidCommand":
              tracker.track("UIEmptyState", {
                extras: { command: repoError.command },
                errorName: "InvalidCommand",
              });
              break;
            case "unknownError":
              tracker.error("UIEmptyState", "RepositoryError", repoError.error);
              break;
          }
        }
      },
      1_000,
      [repoError]
    );
    let content;
    if (repoError != null) {
      if (repoError.type === "cwdNotARepository") {
        content = (
          <EmptyState>
            <div>
              <>Not a valid repository</>
            </div>
            <p>
              <code>{repoError.cwd}</code> is not a valid Graphite repository.
              Clone or init a repository to use GTI.
            </p>
          </EmptyState>
        );
      } else if (repoError.type === "invalidCommand") {
        content = (
          <ErrorNotice
            title={
              <>Invalid Graphite command. Is Graphite installed correctly?</>
            }
            error={new Error(`Command "${repoError.command}" was not found.`)}
            buttons={[
              <VSCodeButton
                key="help-button"
                appearance="secondary"
                onClick={(e) => {
                  platform.openExternalLink(
                    "https://graphite.dev/docs/installing-the-cli"
                  );
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <>See installation docs</>
              </VSCodeButton>,
            ]}
          />
        );
      } else if (repoError.type === "invalidVersion") {
        content = (
          <ErrorNotice
            title={
              <>
                <code>gt</code> upgrade required
              </>
            }
            error={
              new Error(
                `While "${repoError.command}" was found, it is installed at version ${repoError.versionFound}, and version ${repoError.versionRequired} is required.`
              )
            }
            buttons={[
              <VSCodeButton
                key="help-button"
                appearance="secondary"
                onClick={(e) => {
                  platform.openExternalLink(
                    "https://graphite.dev/docs/installing-the-cli"
                  );
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <>See upgrade docs</>
              </VSCodeButton>,
            ]}
          />
        );
      } else {
        content = (
          <ErrorNotice
            title={<>Something went wrong</>}
            error={repoError.error}
          />
        );
      }
    }

    return <div className="empty-app-state">{content}</div>;
  }
);
