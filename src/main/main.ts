import { app, Menu, MenuItem } from 'electron';
import log from 'electron-log';
import * as yargs from 'yargs';
import * as path from 'path';
import * as fs from 'fs';
import { getAppDir, isDevMode } from './utils';
import { execSync } from 'child_process';
import {
  appData,
  SessionConfig,
  SettingType,
  StartupMode,
  userSettings
} from './settings';
import { ContentViewType, MainWindow } from './mainwindow/mainwindow';
import { JupyterApplication } from './app';
import { Registry } from './registry';

/**
 *  * On Mac OSX the PATH env variable a packaged app gets does not
 * contain all the information that is usually set in .bashrc, .bash_profile, etc.
 * This package fixes the PATH variable
 */
require('fix-path')();

let argv = yargs
  .option('v', {
    alias: 'verbose',
    count: true,
    type: 'boolean',
    describe: 'verbose output to terminal'
  })
  .help().argv;

/**
 * Enabled separate logging for development and packaged environments.
 * Also override console methods so that future addition will route to
 * using this package.
 */
let adjustedVerbose = parseInt((argv.verbose as unknown) as string) - 2;
if (isDevMode()) {
  if (adjustedVerbose === 0) {
    log.transports.console.level = 'info';
  } else if (adjustedVerbose === 1) {
    log.transports.console.level = 'verbose';
  } else if (adjustedVerbose >= 2) {
    log.transports.console.level = 'debug';
  }

  log.transports.file.level = false;

  log.info('In development mode');
  log.info(`Logging to console at '${log.transports.console.level}' level`);
} else {
  if (adjustedVerbose === 0) {
    log.transports.file.level = 'info';
  } else if (adjustedVerbose === 1) {
    log.transports.file.level = 'verbose';
  } else if (adjustedVerbose >= 2) {
    log.transports.file.level = 'debug';
  }

  log.transports.console.level = false;

  log.info('In production mode');
  log.info(
    `Logging to file (${log.transports.file.findLogPath()}) at '${
      log.transports.console.level
    }' level`
  );
}

console.log = log.log;
console.error = log.error;
console.warn = log.warn;
console.info = log.info;
console.debug = log.debug;

/**
 * A user-defined service.
 *
 * Services make up the core functionality of the
 * application. Each service is instantiated
 * once and then becomes available to every other service.
 */
export interface IService {
  /**
   * The required services.
   */
  requirements: string[];

  /**
   * The service name that is required by other services.
   */
  provides: string;

  /**
   * A function to create the service object.
   */
  activate: (...x: any[]) => any;

  /**
   * Whether the service should be instantiated immediately,
   * or lazy loaded.
   */
  autostart?: boolean;
}

const thisYear = new Date().getFullYear();

app.setAboutPanelOptions({
  applicationName: 'JupyterLab Desktop',
  applicationVersion: app.getVersion(),
  version: app.getVersion(),
  website: 'https://jupyter.org/about.html',
  copyright: `© 2015-${thisYear}  Project Jupyter Contributors`
});

app.on('open-file', (event: Electron.Event, _path: string) => {
  const sessionConfig = appData.getSessionConfig();
  sessionConfig.workingDirectory = path.dirname(_path);
});

function setupJLabCommand() {
  if (process.platform !== 'darwin') {
    return;
  }

  const symlinkPath = '/usr/local/bin/jlab';
  const targetPath = `${getAppDir()}/app/jlab`;

  if (!fs.existsSync(targetPath)) {
    return;
  }

  try {
    if (!fs.existsSync(symlinkPath)) {
      const cmd = `ln -s ${targetPath} ${symlinkPath}`;
      execSync(cmd, { shell: '/bin/bash' });
      fs.chmodSync(symlinkPath, 0o755);
    }

    // after a DMG install, mode resets
    fs.chmodSync(targetPath, 0o755);
  } catch (error) {
    log.error(error);
  }
}

function setApplicationMenu() {
  if (process.platform !== 'darwin') {
    return;
  }

  // hide Help menu
  const menu = Menu.getApplicationMenu();
  let viewMenu: MenuItem | undefined;
  menu?.items.forEach(item => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (item.role === 'help') {
      item.visible = false;
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (item.role === 'viewmenu') {
      viewMenu = item;
    }
  });
  // hide Reload and Force Reload menu items
  viewMenu?.submenu?.items.forEach(item => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (item.role === 'reload' || item.role === 'forcereload') {
      item.visible = false;
      item.enabled = false;
    }
  });
  Menu.setApplicationMenu(menu);
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
let jupyterApp;
const registry = new Registry();

function startup() {
  const startupMode = userSettings.getValue(
    SettingType.startupMode
  ) as StartupMode;
  if (startupMode === StartupMode.WelcomePage) {
    const window = new MainWindow({
      registry,
      contentView: ContentViewType.Welcome
    });
    window.load();
  } else if (startupMode === StartupMode.LastSessions) {
    const sessionConfig = appData.getSessionConfig();
    const window = new MainWindow({
      registry,
      contentView: ContentViewType.Lab,
      sessionConfig
    });
    window.load();
  } else {
    const sessionConfig = SessionConfig.createLocal();
    const window = new MainWindow({
      registry,
      contentView: ContentViewType.Lab,
      sessionConfig
    });
    window.load();
  }
}

/**
 * Load all services when the electron app is
 * ready.
 */
app.on('ready', () => {
  setApplicationMenu();

  handOverArguments()
    .then(() => {
      setupJLabCommand();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      jupyterApp = new JupyterApplication(registry);
    })
    .catch(e => {
      log.error(e);
      app.quit();
    });

  startup();
});

/**
 * When a second instance of the application is executed, this passes the arguments
 * to first instance. Files that are opened with the application on Linux and Windows
 * will by default instantiate a new instance of the app with the file name as the args.
 * This instead opens the files in the first instance of the
 * application.
 */
function handOverArguments(): Promise<void> {
  let promise = new Promise<void>((resolve, reject) => {
    app.requestSingleInstanceLock();
    // TODO; double check this logic
    app.on('second-instance', (event, argv, cwd) => {
      // Skip JupyterLab Executable
      for (let i = 1; i < argv.length; i++) {
        app.emit('open-file', null, argv[i]);
      }
      reject();
    });
    resolve();
  });
  return promise;
}
