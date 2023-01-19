// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { app, autoUpdater, dialog, ipcMain, shell } from 'electron';

import log from 'electron-log';

import { IRegistry, Registry } from './registry';
import fetch from 'node-fetch';
import * as yaml from 'js-yaml';
import * as semver from 'semver';
import * as path from 'path';
import * as fs from 'fs';

import {
  getAppDir,
  getBundledPythonEnvPath,
  getBundledPythonPath,
  isDarkTheme
} from './utils';
import { execFile } from 'child_process';
import { JupyterServerFactory } from './server';
import { connectAndGetServerInfo, IJupyterServerInfo } from './connect';
import { UpdateDialog } from './updatedialog/updatedialog';
import {
  resolveWorkingDirectory,
  SessionConfig,
  SettingType,
  StartupMode,
  userSettings
} from './config/settings';
import { ContentViewType, MainWindow } from './mainwindow/mainwindow';
import { appData } from './config/appdata';
import { IDisposable } from './tokens';

export interface IApplication {
  checkForUpdates(showDialog: 'on-new-version' | 'always'): void;
  cliArgs: ICLIArguments;
}

export interface ICLIArguments {
  _: (string | number)[];
  // eslint-disable-next-line id-match
  $0: string;
  [x: string]: unknown;
  pythonPath: string | unknown;
  workingDir: string | unknown;
}

export class JupyterApplication implements IApplication, IDisposable {
  /**
   * Construct the Jupyter application
   */
  constructor(cliArgs: ICLIArguments) {
    this._cliArgs = cliArgs;
    this._registry = new Registry();
    this._serverFactory = new JupyterServerFactory(this._registry);
    // create a server in advance
    this._serverFactory.createFreeServer().catch(error => {
      console.error('Failed to create free server', error);
    });
    this._registerListeners();

    if (
      userSettings.getValue(SettingType.checkForUpdatesAutomatically) !== false
    ) {
      let checkDirectly = true;
      if (
        process.platform === 'darwin' &&
        userSettings.getValue(SettingType.installUpdatesAutomatically) !== false
      ) {
        this._setupAutoUpdater();
        checkDirectly = false;
      }

      if (checkDirectly) {
        setTimeout(() => {
          this.checkForUpdates('on-new-version');
        }, 5000);
      }
    }

    this.startup();
  }

  get cliArgs(): ICLIArguments {
    return this._cliArgs;
  }

  private _sessionConfigFromArgs() {
    let workingDir = this._cliArgs.workingDir;
    let fileOrFolders: string[] = [];
    let pythonPath = '';

    try {
      let skipFilePaths = false;
      if (workingDir) {
        workingDir = path.resolve(workingDir as string);
        if (!fs.existsSync(workingDir as string)) {
          workingDir = null;
          skipFilePaths = true;
        }
      }

      if (!skipFilePaths) {
        for (let filePath of this._cliArgs._) {
          if (workingDir) {
            filePath = path.resolve(workingDir as string, filePath.toString());
            if (fs.existsSync(filePath)) {
              const relPath = path.relative(workingDir as string, filePath);
              fileOrFolders.push(relPath);
            }
          } else {
            filePath = path.resolve(filePath.toString());
            fileOrFolders.push(filePath);
          }
        }
      }

      if (this._cliArgs.pythonPath) {
        pythonPath = path.resolve(this._cliArgs.pythonPath as string);
        if (!fs.existsSync(pythonPath)) {
          pythonPath = '';
        }
      }
    } catch (error) {
      return;
    }

    if (!(workingDir || fileOrFolders.length > 0 || pythonPath)) {
      return;
    }

    if (workingDir) {
      const sessionConfig = SessionConfig.createLocal(
        workingDir as string,
        fileOrFolders
      );
      if (pythonPath) {
        sessionConfig.pythonPath = pythonPath;
      }

      return sessionConfig;
    } else {
      const sessionConfig =
        fileOrFolders.length > 0
          ? SessionConfig.createLocalForFilesOrFolders(fileOrFolders)
          : SessionConfig.createLocal();
      if (pythonPath) {
        sessionConfig.pythonPath = pythonPath;
      }

      return sessionConfig;
    }
  }

  startup() {
    const startupMode = userSettings.getValue(
      SettingType.startupMode
    ) as StartupMode;

    // if launching from CLI, parse settings
    const sessionConfig = this._sessionConfigFromArgs();

    if (sessionConfig) {
      const window = new MainWindow({
        app: this,
        registry: this._registry,
        serverFactory: this._serverFactory,
        contentView: ContentViewType.Lab,
        sessionConfig
      });
      window.load();
      this._mainWindow = window;

      return;
    }

    if (
      startupMode === StartupMode.LastSessions &&
      appData.sessions.length > 0
    ) {
      const sessionConfig = appData.sessions[0];
      const window = new MainWindow({
        app: this,
        registry: this._registry,
        serverFactory: this._serverFactory,
        contentView: ContentViewType.Lab,
        sessionConfig,
        center: false
      });
      window.load();
      this._mainWindow = window;

      return;
    }

    if (startupMode === StartupMode.NewLocalSession) {
      const sessionConfig = SessionConfig.createLocal();
      const window = new MainWindow({
        app: this,
        registry: this._registry,
        serverFactory: this._serverFactory,
        contentView: ContentViewType.Lab,
        sessionConfig
      });
      window.load();
      this._mainWindow = window;
    } else {
      const window = new MainWindow({
        app: this,
        registry: this._registry,
        serverFactory: this._serverFactory,
        contentView: ContentViewType.Welcome
      });
      window.load();
      this._mainWindow = window;
    }
  }

  handleOpenFilesOrFolders(fileOrFolders?: string[]) {
    this._mainWindow.handleOpenFilesOrFolders(fileOrFolders);
  }

  dispose(): Promise<void> {
    if (this._disposePromise) {
      return this._disposePromise;
    }

    this._disposePromise = new Promise<void>((resolve, reject) => {
      Promise.all([
        this._registry.dispose(),
        this._serverFactory.dispose(),
        this._mainWindow.dispose()
      ])
        .then(() => {
          resolve();
        })
        .catch(error => {
          console.error(
            'There was a problem shutting down the application',
            error
          );
          resolve();
        });
    });

    return this._disposePromise;
  }

  private _setupAutoUpdater() {
    autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
      const dialogOpts = {
        type: 'info',
        buttons: ['Restart', 'Later'],
        title: 'Application Update',
        message: process.platform === 'win32' ? releaseNotes : releaseName,
        detail:
          'A new version has been downloaded. Restart the application to apply the updates.'
      };

      dialog.showMessageBox(dialogOpts).then(returnValue => {
        if (returnValue.response === 0) autoUpdater.quitAndInstall();
      });
    });

    autoUpdater.on('error', message => {
      log.error('There was a problem updating the application');
      log.error(message);
    });

    require('update-electron-app')();
  }

  private _validateRemoteServerUrl(url: string): Promise<IJupyterServerInfo> {
    return connectAndGetServerInfo(url, { showDialog: true, incognito: true });
  }

  /**
   * Register all application event listeners
   */
  private _registerListeners(): void {
    app.on('will-quit', event => {
      event.preventDefault();
      appData.save();
      userSettings.save();

      this._quit();
    });

    ipcMain.on('set-check-for-updates-automatically', (_event, autoUpdate) => {
      userSettings.setValue(
        SettingType.checkForUpdatesAutomatically,
        autoUpdate
      );
    });

    ipcMain.on('set-install-updates-automatically', (_event, install) => {
      userSettings.setValue(SettingType.installUpdatesAutomatically, install);
    });

    ipcMain.on('launch-installer-download-page', () => {
      shell.openExternal(
        'https://github.com/jupyterlab/jupyterlab-desktop/releases'
      );
    });

    ipcMain.on('launch-about-jupyter-page', () => {
      shell.openExternal('https://jupyter.org/about.html');
    });

    ipcMain.on('select-working-directory', event => {
      const currentPath = userSettings.resolvedWorkingDirectory;

      dialog
        .showOpenDialog({
          properties: ['openDirectory', 'showHiddenFiles', 'noResolveAliases'],
          buttonLabel: 'Choose',
          defaultPath: currentPath
        })
        .then(({ filePaths }) => {
          if (filePaths.length > 0) {
            event.sender.send('working-directory-selected', filePaths[0]);
          }
        });
    });

    ipcMain.on('set-default-working-directory', (event, path: string) => {
      try {
        const resolved = resolveWorkingDirectory(path, false);
        const stat = fs.lstatSync(resolved);
        if (stat.isDirectory()) {
          userSettings.setValue(SettingType.defaultWorkingDirectory, path);
          event.sender.send('set-default-working-directory-result', 'SUCCESS');
        } else {
          event.sender.send(
            'set-default-working-directory-result',
            'INVALID-PATH'
          );
          console.error('Failed to set working directory');
        }
      } catch (error) {
        event.sender.send('set-default-working-directory-result', 'FAILURE');
        console.error('Failed to set working directory');
      }
    });

    ipcMain.on('select-python-path', (event, currentPath) => {
      if (!currentPath) {
        currentPath = userSettings.getValue(SettingType.pythonPath);
        if (currentPath === '') {
          currentPath = getBundledPythonPath();
        }
      }

      dialog
        .showOpenDialog({
          properties: ['openFile', 'showHiddenFiles', 'noResolveAliases'],
          buttonLabel: 'Use Path',
          defaultPath: currentPath
        })
        .then(({ filePaths }) => {
          if (filePaths.length > 0) {
            event.sender.send('custom-python-path-selected', filePaths[0]);
          }
        });
    });

    ipcMain.on('install-bundled-python-env', event => {
      event.sender.send('install-bundled-python-env-status', 'STARTED');
      const platform = process.platform;
      const isWin = platform === 'win32';
      const appDir = getAppDir();
      const appVersion = app.getVersion();
      const installerPath = isWin
        ? `${appDir}\\env_installer\\JupyterLabDesktopAppServer-${appVersion}-Windows-x86_64.exe`
        : platform === 'darwin'
        ? `${appDir}/env_installer/JupyterLabDesktopAppServer-${appVersion}-MacOSX-x86_64.sh`
        : `${appDir}/env_installer/JupyterLabDesktopAppServer-${appVersion}-Linux-x86_64.sh`;
      const installPath = getBundledPythonEnvPath();

      if (fs.existsSync(installPath)) {
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          message: 'Do you want to overwrite?',
          detail: `Install path (${installPath}) is not empty. Would you like to overwrite it?`,
          buttons: ['Overwrite', 'Cancel'],
          defaultId: 1,
          cancelId: 1
        });

        if (choice === 0) {
          fs.rmdirSync(installPath, { recursive: true });
        } else {
          event.sender.send('install-bundled-python-env-status', 'CANCELLED');
          return;
        }
      }

      const installerProc = execFile(installerPath, ['-b', '-p', installPath], {
        shell: isWin ? 'cmd.exe' : '/bin/bash',
        env: {
          ...process.env
        }
      });

      installerProc.on('exit', (exitCode: number) => {
        if (exitCode === 0) {
          event.sender.send('install-bundled-python-env-status', 'SUCCESS');
        } else {
          const message = `Installer Exit: ${exitCode}`;
          event.sender.send(
            'install-bundled-python-env-status',
            'FAILURE',
            message
          );
          log.error(new Error(message));
        }
      });

      installerProc.on('error', (err: Error) => {
        event.sender.send(
          'install-bundled-python-env-status',
          'FAILURE',
          err.message
        );
        log.error(err);
      });
    });

    ipcMain.handle('validate-python-path', (event, path) => {
      return this._registry.validatePythonEnvironmentAtPath(path);
    });

    ipcMain.handle('validate-remote-server-url', (event, url) => {
      return new Promise<any>((resolve, reject) => {
        this._validateRemoteServerUrl(url)
          .then(value => {
            resolve({ result: 'valid' });
          })
          .catch(error => {
            resolve({ result: 'invalid', error: error.message });
          });
      });
    });

    ipcMain.on('show-invalid-python-path-message', (event, path) => {
      const requirements = this._registry.getRequirements();
      const reqVersions = requirements.map(
        req => `${req.name} ${req.versionRange.format()}`
      );
      const reqList = reqVersions.join(', ');
      const message = `Failed to find a compatible Python environment at the configured path "${path}". Environment Python package requirements are: ${reqList}.`;
      dialog.showMessageBox({ message, type: 'error' });
    });

    ipcMain.on('set-default-python-path', (event, path) => {
      userSettings.setValue(SettingType.pythonPath, path);
    });

    ipcMain.on('set-startup-mode', (_event, mode) => {
      userSettings.setValue(SettingType.startupMode, mode);
    });

    ipcMain.on('set-theme', (_event, theme) => {
      userSettings.setValue(SettingType.theme, theme);
    });

    ipcMain.on('set-sync-jupyterlab-theme', (_event, sync) => {
      userSettings.setValue(SettingType.syncJupyterLabTheme, sync);
    });

    ipcMain.on('set-show-news-theme', (_event, show) => {
      userSettings.setValue(SettingType.showNewsFeed, show);
    });

    ipcMain.on('set-frontend-mode', (_event, mode) => {
      userSettings.setValue(SettingType.frontEndMode, mode);
    });

    ipcMain.on('restart-app', _event => {
      app.relaunch();
      app.quit();
    });

    ipcMain.on('check-for-updates', _event => {
      this.checkForUpdates('always');
    });

    ipcMain.handle('is-dark-theme', event => {
      return isDarkTheme(userSettings.getValue(SettingType.theme));
    });
  }

  private _showUpdateDialog(
    type: 'updates-available' | 'error' | 'no-updates'
  ) {
    const dialog = new UpdateDialog({
      isDarkTheme: isDarkTheme(userSettings.getValue(SettingType.theme)),
      type
    });

    dialog.load();
  }

  checkForUpdates(showDialog: 'on-new-version' | 'always') {
    fetch(
      'https://github.com/jupyterlab/jupyterlab-desktop/releases/latest/download/latest.yml'
    )
      .then(async response => {
        try {
          const data = await response.text();
          const latestReleaseData = yaml.load(data);
          const latestVersion = (latestReleaseData as any).version;
          const currentVersion = app.getVersion();
          const newVersionAvailable =
            semver.compare(currentVersion, latestVersion) === -1;
          if (showDialog === 'always' || newVersionAvailable) {
            this._showUpdateDialog(
              newVersionAvailable ? 'updates-available' : 'no-updates'
            );
          }
        } catch (error) {
          if (showDialog === 'always') {
            this._showUpdateDialog('error');
          }
          console.error('Failed to check for updates:', error);
        }
      })
      .catch(error => {
        if (showDialog === 'always') {
          this._showUpdateDialog('error');
        }
        console.error('Failed to check for updates:', error);
      });
  }

  private _quit(): void {
    this.dispose()
      .then(() => {
        process.exit();
      })
      .catch(err => {
        log.error(new Error('JupyterLab could not close successfully'));
        process.exit();
      });
  }

  readonly id = 'JupyterLabDesktop';
  private _cliArgs: ICLIArguments;
  private _registry: IRegistry;
  private _serverFactory: JupyterServerFactory;
  /**
   * The most recently focused window
   */
  private _disposePromise: Promise<void>;
  private _mainWindow: MainWindow;
}
