// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// Note: keep this file minimal since it is bundled into preload.js

// events sent to Main process
export enum EventTypeMain {
  MinimizeWindow = 'minimize-window',
  MaximizeWindow = 'maximize-window',
  RestoreWindow = 'restore-window',
  CloseWindow = 'close-window',
  OpenFileOrFolder = 'open-file-or-folder',
  OpenFile = 'open-file',
  OpenFolder = 'open-folder',
  CreateNewSession = 'create-new-session',
  CreateNewRemoteSession = 'create-new-remote-session',
  OpenRecentSession = 'open-recent-session',
  OpenRecentSessionWithDefaultEnv = 'open-recent-session-with-default-env',
  DeleteRecentSession = 'delete-recent-session',
  OpenDroppedFiles = 'open-dropped-files',
  OpenNewsLink = 'open-news-link',
  SetPythonPath = 'set-python-path',
  ShowEnvSelectPopup = 'show-env-select-popup',
  HideEnvSelectPopup = 'hide-env-select-popup',
  SetRemoteServerOptions = 'set-remote-server-options',
  ShowAppContextMenu = 'show-app-context-menu',
  HideProgressView = 'hide-progress-view',
  ShowWelcomeView = 'show-welcome-view',
  ShowServerPreferences = 'show-server-preferences',
  TitleBarMouseEvent = 'titlebar-mouse-event',
  DeleteRecentRemoteURL = 'delete-recent-remote-url',
  LabUIReady = 'lab-ui-ready',
  SetTheme = 'set-theme',
  SetCheckForUpdatesAutomatically = 'set-check-for-updates-automatically',
  SetInstallUpdatesAutomatically = 'set-install-updates-automatically',
  LaunchInstallerDownloadPage = 'launch-installer-download-page',
  LaunchAboutJupyterPage = 'launch-about-jupyter-page',
  SelectWorkingDirectory = 'select-working-directory',
  SetDefaultWorkingDirectory = 'set-default-working-directory',
  SelectPythonPath = 'select-python-path',
  InstallBundledPythonEnv = 'install-bundled-python-env',
  ValidatePythonPath = 'validate-python-path',
  ValidateRemoteServerUrl = 'validate-remote-server-url',
  SetDefaultPythonPath = 'set-default-python-path',
  SetStartupMode = 'set-startup-mode',
  SetSyncJupyterLabTheme = 'set-sync-jupyterlab-theme',
  SetShowNewsFeed = 'set-show-news-feed',
  SetFrontendMode = 'set-frontend-mode',
  RestartApp = 'restart-app',
  CheckForUpdates = 'check-for-updates',
  GetServerInfo = 'get-server-info',
  IsDarkTheme = 'is-dark-theme',
  ClearHistory = 'clear-history',
  ShowInvalidPythonPathMessage = 'show-invalid-python-path-message'
}

// events sent to Renderer process
export enum EventTypeRenderer {
  WorkingDirectorySelected = 'working-directory-selected',
  InstallBundledPythonEnvStatus = 'install-bundled-python-env-status',
  CustomPythonPathSelected = 'custom-python-path-selected',
  ShowProgress = 'show-progress',
  SetCurrentPythonPath = 'set-current-python-path',
  UpdateRecentRemoteURLs = 'update-recent-remote-urls',
  SetRunningServerList = 'set-running-server-list',
  SetTitle = 'set-title',
  SetActive = 'set-active',
  ShowServerStatus = 'show-server-status',
  SetRecentSessionList = 'set-recent-session-list',
  SetNewsList = 'set-news-list',
  SetNotificationMessage = 'set-notification-message',
  DisabledLocalServerActions = 'disable-local-server-actions'
}
