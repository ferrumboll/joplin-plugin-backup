import { Settings } from "./settings";
import { MenuItemLocation } from "api/types";
import joplin from "api";
import * as path from "path";
import backupLogging from "electron-log";
import * as fs from "fs-extra";
import { sevenZip } from "./sevenZip";
import * as moment from "moment";
import * as AWS from "aws-sdk";

class Backup {
  private errorDialog: any;
  private backupBasePath: string;
  private activeBackupPath: string;
  private log: any;
  private logFile: string;
  private backupRetention: number;
  private timer: any;
  private passwordEnabled: boolean;
  private password: string;
  private backupStartTime: Date;
  private zipArchive: string;
  private compressionLevel: number;
  private singleJex: boolean;
  private backupSetName: string;
  private bucketName: string;
  private backupsFolder: string;
  private s3Endpoint: string;
  private s3Key: string;
  private s3Secret: string;

  constructor() {
    this.log = backupLogging;
    this.setupLog();
  }

  public async init() {
    this.log.verbose("Backup Plugin init");

    const installationDir = await joplin.plugins.installationDir();
    this.logFile = path.join(installationDir, "activeBackup.log");

    await this.registerSettings();
    await this.registerCommands();
    await this.registerMenues();
    await this.createErrorDialog();
    await this.loadSettings();
    await this.startTimer();
    await this.upgradeBackupTargetVersion();
    await sevenZip.updateBinPath();
    await sevenZip.setExecutionFlag();
    this.backupStartTime = null;
  }

  private async upgradeBackupTargetVersion() {
    let version = await joplin.settings.value("backupVersion");
    const targetVersion = 1;
    for (
      let checkVersion = version + 1;
      checkVersion <= targetVersion;
      checkVersion++
    ) {
      try {
        if (checkVersion === 1) {
          if (this.backupBasePath !== "" && this.backupRetention > 1) {
            await this.saveOldBackupInfo();
          }
        }

        version = checkVersion;
        await joplin.settings.setValue("backupVersion", version);
      } catch (e) {
        await this.showError(`Upgrade error ${checkVersion}: ${e.message}`);
      }
    }
  }

  private async saveOldBackupInfo() {
    const folders = fs
      .readdirSync(this.backupBasePath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .reverse();

    for (let folder of folders) {
      if (parseInt(folder) > 202100000000) {
        let date = new Date(
          folder.substring(0, 4),
          folder.substring(4, 6) - 1,
          folder.substring(6, 8),
          folder.substring(8, 10),
          folder.substring(10, 12)
        );

        await this.saveBackupInfo(folder, date.getTime());
      }
    }
  }

  private async saveBackupInfo(folder: string, date: number) {
    const info = JSON.parse(await joplin.settings.value("backupInfo"));
    const backup = { name: folder, date: date };
    info.push(backup);
    await joplin.settings.setValue("backupInfo", JSON.stringify(info));
  }

  public async registerSettings() {
    await Settings.register();
  }

  private async enablePassword() {
    const usePassword = await joplin.settings.value("usePassword");
    if (usePassword === true && (await this.checkPassword()) === 1) {
      this.passwordEnabled = true;
      this.password = await joplin.settings.value("password");
    } else {
      this.passwordEnabled = false;
      this.password = null;

      await joplin.settings.setValue("password", "password");
      await joplin.settings.setValue("passwordRepeat", "repeat12");
    }
  }

  private async checkPassword(): Promise<number> {
    const password: string = await joplin.settings.value("password");
    const passwordRepeat: string = await joplin.settings.value(
      "passwordRepeat"
    );
    if ((await joplin.settings.value("usePassword")) === false) {
      return 0; // Not set
    } else if (
      password.trim() !== passwordRepeat.trim() ||
      password.trim() === ""
    ) {
      return -1; // PWs not OK
    } else {
      return 1; // PW OK
    }
  }

  private async setupLog() {
    const logFormat = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
    this.log.transports.file.level = false;
    this.log.transports.file.format = logFormat;
    this.log.transports.console.level = "verbose";
    this.log.transports.console.format = logFormat;
  }

  private async fileLogging(enable: boolean) {
    const fileLogLevel = await joplin.settings.value("fileLogLevel");

    if (enable === true && fileLogLevel !== "false") {
      this.log.transports.file.resolvePath = () => this.logFile;
      this.log.transports.file.level = fileLogLevel;
    } else {
      this.log.transports.file.level = false;
    }
  }

  private async deleteLogFile() {
    this.log.verbose("Delete log file");
    if (fs.existsSync(this.logFile)) {
      try {
        await fs.unlinkSync(this.logFile);
      } catch (e) {
        this.log.error("deleteLogFile: " + e.message);
      }
    }
  }

  public async registerCommands() {
    await joplin.commands.register({
      name: "CreateBackup",
      label: "Create backup",
      execute: async () => {
        await this.start(true);
      },
    });
  }

  public async registerMenues() {
    await joplin.views.menuItems.create(
      "myMenuItemToolsCreateBackup",
      "CreateBackup",
      MenuItemLocation.Tools
    );
  }

  private async loadBackupPath() {
    this.log.verbose("loadBackupPath");
    const pathSetting = await joplin.settings.value("path");
    const profileDir = await joplin.settings.globalValue("profileDir");

    if (path.isAbsolute(pathSetting)) {
      this.backupBasePath = path.normalize(pathSetting);
    } else {
      this.backupBasePath = path.join(
        path.normalize(profileDir),
        path.normalize(pathSetting)
      );
    }

    if (path.normalize(profileDir) === this.backupBasePath) {
      this.backupBasePath = null;
    }
  }

  public async loadSettings() {
    this.log.verbose("loadSettings");
    await this.loadBackupPath();

    this.bucketName = await joplin.settings.value("bucketName")
    this.s3Endpoint = await joplin.settings.value("s3Endpoint")
    this.s3Key = await joplin.settings.value("s3Key")
    this.s3Secret = await joplin.settings.value("s3Secret")
    this.backupsFolder = await joplin.settings.value("backupsFolder")

    this.backupRetention = await joplin.settings.value("backupRetention");

    this.zipArchive = await joplin.settings.value("zipArchive");
    this.compressionLevel = await joplin.settings.value("compressionLevel");
    this.singleJex = await joplin.settings.value("singleJex");

    this.backupSetName = await joplin.settings.value("backupSetName");
    if (
      this.backupSetName.trim() === "" ||
      (await this.getBackupSetFolderName()).trim() === ""
    ) {
      this.backupSetName = "{YYYYMMDDHHmm}";
    }

    await this.enablePassword();
    await this.setActiveBackupPath();
  }

  private async createErrorDialog() {
    this.errorDialog = await joplin.views.dialogs.create("backupDialog");
    await joplin.views.dialogs.addScript(this.errorDialog, "webview.css");
  }

  private async showError(msg: string, title: string = null) {
    const html = [];

    if (title !== null) {
      this.log.error(`${title}: ${msg}`);
    } else {
      this.log.error(`${msg}`);
    }

    html.push('<div id="backuperror" style="backuperror">');
    html.push(`<h3>Backup plugin</h3>`);
    if (title) {
      html.push(`<p>${title}</p>`);
    }
    html.push(`<div id="errormsg">${msg}`);
    html.push("</div>");
    await joplin.views.dialogs.setButtons(this.errorDialog, [{ id: "ok" }]);
    await joplin.views.dialogs.setHtml(this.errorDialog, html.join("\n"));
    await joplin.views.dialogs.open(this.errorDialog);
    this.backupStartTime = null;
  }

  public async setActiveBackupPath() {
    let exportPath = await joplin.settings.value("exportPath");
    const profileDir = await joplin.settings.globalValue("profileDir");
    const tempDir = await joplin.settings.globalValue("tempDir");

    if (exportPath !== "") {
      if (path.isAbsolute(exportPath)) {
        exportPath = path.normalize(exportPath);
      } else {
        exportPath = path.join(
          path.normalize(profileDir),
          path.normalize(exportPath)
        );
      }
    }

    const folderName = "joplin_active_backup_job";
    if (this.backupBasePath !== null) {
      if (exportPath !== "") {
        this.activeBackupPath = path.join(exportPath, folderName);
      } else if (this.passwordEnabled === true) {
        this.activeBackupPath = path.join(tempDir, folderName);
      } else {
        this.activeBackupPath = path.join(this.backupBasePath, folderName);
      }
    } else {
      this.activeBackupPath = null;
    }
  }

  private async logSettings(showDoneMsg: boolean) {
    const settings = [
      "path",
      "singleJex",
      "backupRetention",
      "backupInterval",
      "onlyOnChange",
      "usePassword",
      "lastBackup",
      "fileLogLevel",
      "zipArchive",
      "compressionLevel",
      "exportPath",
      "backupSetName",
      "backupInfo",
    ];

    this.log.verbose("Plugin settings:");
    for (let setting of settings) {
      this.log.verbose(setting + ": " + (await joplin.settings.value(setting)));
    }
    this.log.verbose("activeBackupPath: " + this.activeBackupPath);
    this.log.verbose("backupBasePath: " + this.backupBasePath);
    this.log.verbose("logFile: " + this.logFile);
    this.log.verbose("showDoneMsg: " + showDoneMsg);
    this.log.verbose(
      "installationDir: " + (await joplin.plugins.installationDir())
    );
  }

  public async start(showDoneMsg: boolean = false) {
    if (this.backupStartTime === null) {
      this.backupStartTime = new Date();

      await this.deleteLogFile();
      await this.fileLogging(true);
      this.log.info("Backup started");

      await this.stopTimer();

      await this.loadSettings();

      await this.logSettings(showDoneMsg);

      if (this.backupBasePath === null) {
        await this.showError(
          "Please configure backup path in Joplin Tools > Options > Backup"
        );
        return;
      }

      if (fs.existsSync(this.backupBasePath)) {
        if ((await this.checkPassword()) === -1) {
          await this.showError("Passwords do not match!");
          return;
        } else {
          this.log.info("Enable password protection: " + this.passwordEnabled);
        }
        this.log.verbose(`Backup path: ${this.backupBasePath}`);
        this.log.verbose(
          `Active backup path (export path): ${this.activeBackupPath}`
        );
        await this.createEmptyFolder(this.activeBackupPath, "");

        await this.backupProfileData();

        await this.backupNotebooks();

        const backupDst = await this.makeBackupSet();

        await joplin.settings.setValue(
          "lastBackup",
          this.backupStartTime.getTime()
        );
        this.log.info("Backup finished to: " + backupDst);

        this.log.info("Backup completed");
        await this.fileLogging(false);

        this.moveLogFile(backupDst);
      } else {
        await this.showError(
          `The Backup path '${this.backupBasePath}' does not exist!`
        );
      }

      this.backupStartTime = null;
      await this.startTimer();
    } else {
      this.log.warn(
        "Backup already running since " +
          moment(this.backupStartTime).format("YYYY-MM-DD HH:MM:SS") +
          " (" +
          this.backupStartTime.getTime() +
          ")"
      );
    }
  }

  private async makeBackupSet(): Promise<string> {
    let backupDst = "";
    if (this.zipArchive === "no" && this.passwordEnabled === false) {
      if (this.backupRetention > 1) {
        backupDst = await this.moveFinishedBackup();
        await this.deleteOldBackupSets(
          this.backupBasePath,
          this.backupRetention
        );
      } else {
        await this.clearBackupTarget(this.backupBasePath);
        backupDst = await this.moveFinishedBackup();
      }
    } else {
      const zipFile = await this.createZipArchive();
      if (this.backupRetention > 1) {
        backupDst = await this.moveFinishedBackup(zipFile);
        try {
          fs.removeSync(this.activeBackupPath);
        } catch (e) {
          await this.showError("" + e.message);
          throw e;
        }
        await this.deleteOldBackupSets(
          this.backupBasePath,
          this.backupRetention
        );
      } else {
        await this.clearBackupTarget(this.backupBasePath);
        backupDst = await this.moveFinishedBackup(zipFile);
      }
    }

    return backupDst;
  }

  private async createZipArchive() {
    this.log.info(`Create zip archive`);

    let zipFile = null;
    if (
      this.zipArchive === "yesone" ||
      (this.singleJex === true && this.zipArchive === "yes")
    ) {
      zipFile = await this.addToZipArchive(
        path.join(this.backupBasePath, "newJoplinBackup.7z"),
        path.join(this.activeBackupPath, "*"),
        this.password
      );
    } else {
      const content = fs.readdirSync(this.activeBackupPath, {
        withFileTypes: true,
      });

      for (const file of content) {
        await this.addToZipArchive(
          path.join(this.activeBackupPath, file.name + ".7z"),
          path.join(
            this.activeBackupPath,
            file.isFile() ? file.name : path.join(file.name, "*")
          ),
          this.password
        );

        try {
          fs.removeSync(path.join(this.activeBackupPath, file.name));
        } catch (e) {
          await this.showError("" + e.message);
          throw e;
        }
      }
    }

    return zipFile;
  }

  private async addToZipArchive(
    zipFile: string,
    addFile: string,
    password: string,
    options: string[] = null
  ): Promise<string> {
    this.log.verbose(`Add ${addFile} to zip ${zipFile}`);

    let zipOptions: any = {};
    if (options) {
      zipOptions = { ...zipOptions, ...options };
    }
    zipOptions.method = [];
    if (this.compressionLevel) {
      zipOptions.method.push("x" + this.compressionLevel);
    } else {
      zipOptions.method.push("x0");
    }

    const status = await sevenZip.add(zipFile, addFile, password, zipOptions);
    if (status !== true) {
      await this.showError("createZipArchive: " + status);
      throw new Error("createZipArchive: " + status);
    }

    return zipFile;
  }

  private async moveLogFile(logDst: string): Promise<boolean> {
    const logfileName = "backup.log";
    let logFile = this.logFile;
    if (fs.existsSync(logFile)) {
      if (this.zipArchive === "yesone" || this.password !== null) {
        if (fs.statSync(logDst).isDirectory()) {
          logDst = path.join(logDst, "backuplog.7z");
        }
        try {
          const newlogFile = path.join(path.dirname(logFile), logfileName);
          fs.renameSync(logFile, newlogFile);
          logFile = newlogFile;
        } catch (e) {
          await this.showError("moveLogFile: " + e.message);
          throw e;
        }
        await this.addToZipArchive(logDst, logFile, this.password, ["-sdel"]);
      } else {
        try {
          fs.moveSync(logFile, path.join(logDst, logfileName));
        } catch (e) {
          await this.showError("moveLogFile: " + e.message);
          throw e;
        }
      }
      return true;
    } else {
      return false;
    }
  }

  private async backupNotebooks() {
    const notebooks = await this.selectNotebooks();

    if (this.singleJex === true) {
      this.log.info("Create single file JEX backup");
      await this.jexExport(
        notebooks.ids,
        path.join(this.activeBackupPath, "all_notebooks.jex")
      );
      await this.sendToS3(this.activeBackupPath);
    } else {
      this.log.info("Export each notbook as JEX backup");
      for (const folderId of notebooks.ids) {
        if ((await this.notebookHasNotes(folderId)) === true) {
          this.log.verbose(
            `Export ${notebooks.info[folderId]["title"]} (${folderId})`
          );
          const notebookFile = await this.getNotebookFileName(
            notebooks.info,
            folderId
          );
          await this.jexExport(
            folderId,
            path.join(this.activeBackupPath, notebookFile)
          );
          await this.sendToS3(this.activeBackupPath);
        } else {
          this.log.verbose(
            `Skip ${notebooks.info[folderId]["title"]} (${folderId}) since no notes in notebook`
          );
        }
      }
    }
  }

  private async getS3SavePath(): Promise<string> {

    function pad2(n) {
      return (n < 10 ? '0' : '') + n;
    }
    
    const backupDate = new Date();
    const month = pad2(backupDate.getMonth()+1);//months (0-11)
    const day = pad2(backupDate.getDate());//day (1-31)
    const year = backupDate.getFullYear();
    const hour = pad2(backupDate.getHours())
    return this.backupsFolder + "/" + year + "-" + month + "-" + day + "/" + hour

  }
  
  private async sendToS3(
    directory: string
  ) {
    const savePath = await this.getS3SavePath()
  
    // Create an S3 client
    var credentials = new AWS.SharedIniFileCredentials({profile: 'b2'});
    AWS.config.credentials = credentials;
    var ep = new AWS.Endpoint(this.s3Endpoint);
    var s3 = new AWS.S3({
      endpoint: ep,
      accessKeyId: this.s3Key, 
      secretAccessKey: this.s3Secret, 
    });
    var files = fs.readdirSync(directory);
    let bucketName = this.bucketName
    for(let file of files) {
      if(file.endsWith(".jex")) {
      this.log.info("Uploading " + file)
      const fileSavePath = savePath + "/" + file;
      const filePath = path.join(directory, file);
      var params = {Bucket: bucketName, Key: fileSavePath, Body: fs.readFileSync(filePath)};
      this.log.info(params)
      let log = this.log
      s3.putObject(params, function(err, data) {
        if (err)
        log.info(err)
        else
        log.info("Successfully uploaded data to " + bucketName + "/" + fileSavePath);
        });
      }
    }
  }

  private async getNotebookFileName(
    notebooks: any,
    id: string
  ): Promise<string> {
    const names = [];
    let parentId = "";

    do {
      names.push(notebooks[id].title);
      parentId = notebooks[id].parent_id;
      id = parentId;
    } while (parentId != "");
    return (
      names
        .reverse()
        .join("_")
        .replace(/[/\\?%*:|"<>]/g, "_") + ".jex"
    );
  }

  private async notebookHasNotes(notebookId: string): Promise<boolean> {
    let noteCheck = await joplin.data.get(["folders", notebookId, "notes"], {
      fields: "title, id",
    });

    if (noteCheck.items.length > 0) {
      return true;
    } else {
      return false;
    }
  }

  private async jexExport(notebookIds: string[], file: string) {
    try {
      let status: string = await joplin.commands.execute(
        "exportFolders",
        notebookIds,
        "jex",
        file
      );
    } catch (e) {
      this.showError("Backup error", "jexExport: " + e.message);
      throw e;
    }
  }

  private async selectNotebooks(): Promise<any> {
    const noteBookInfo = {};
    const noteBooksIds = [];
    let pageNum = 0;
    this.log.info("Select notebooks for export");
    do {
      var folders = await joplin.data.get(["folders"], {
        fields: "id, title, parent_id",
        limit: 50,
        page: pageNum++,
      });
      for (const folder of folders.items) {
        noteBooksIds.push(folder.id);
        noteBookInfo[folder.id] = {};
        noteBookInfo[folder.id]["title"] = folder.title;
        noteBookInfo[folder.id]["parent_id"] = folder.parent_id;
        this.log.verbose("Add '" + folder.title + "' (" + folder.id + ")");
      }
    } while (folders.has_more);

    return {
      ids: noteBooksIds,
      info: noteBookInfo,
    };
  }

  private async getLastChangeDate(): Promise<number> {
    this.log.verbose("getLastChangeDate");

    let lastUpdate = 0;
    const toCheck = ["folders", "notes", "resources", "tags"];
    for (let check of toCheck) {
      try {
        let checkUpdated = await joplin.data.get([check], {
          fields: "title, id, updated_time",
          order_by: "updated_time",
          order_dir: "DESC",
          limit: 10,
          page: 1,
        });
        if (
          checkUpdated.items.length > 0 &&
          checkUpdated.items[0].updated_time > lastUpdate
        ) {
          lastUpdate = checkUpdated.items[0].updated_time;
        }
      } catch (error) {
        this.log.error(error);
      }
    }
    return lastUpdate;
  }

  public async stopTimer() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  public async startTimer() {
    if (this.timer === undefined || this.timer === null) {
      this.timer = setTimeout(this.backupTime.bind(this), 1000 * 60 * 1);
    }
  }

  private async backupTime() {
    this.log.verbose("backupTime");

    const checkEver = 5;
    const backupInterval = await joplin.settings.value("backupInterval");
    const lastBackup = await joplin.settings.value("lastBackup");
    const onlyOnChange = await joplin.settings.value("onlyOnChange");
    const lastChange = await this.getLastChangeDate();
    const now = new Date();

    if (backupInterval > 0) {
      if (now.getTime() > lastBackup + backupInterval * 60 * 60 * 1000) {
        this.log.info("Backup interval reached");
        if (
          onlyOnChange === false ||
          (onlyOnChange === true &&
            (lastChange === 0 || lastBackup < lastChange))
        ) {
          await this.start(false);
        } else {
          this.log.info("create no backup (no change)");
        }
      }
      this.timer = setTimeout(
        this.backupTime.bind(this),
        1000 * 60 * checkEver
      );
    } else {
      this.log.info("Automatic backup disabled");
      this.timer = null;
    }
  }

  private async getBackupSetFolderName(folder: string = null): Promise<string> {
    return this.backupSetName.replace(/{([^}]+)}/g, (match, groups) => {
      const now = new Date(Date.now());
      return moment(now.getTime()).format(groups);
    });
  }

  private async createEmptyFolder(
    inPath: string,
    folder: string
  ): Promise<string> {
    const dir = path.join(inPath, folder);
    this.log.verbose("Create folder " + dir);
    try {
      fs.emptyDirSync(dir);
      return dir;
    } catch (e) {
      await this.showError("createEmptyFolder: " + e.message);
      throw e;
    }
  }

  private async backupProfileData() {
    this.log.info("Backup Profile Data");

    const activeBackupFolderProfile = await this.createEmptyFolder(
      this.activeBackupPath,
      "profile"
    );
    const profileDir = await joplin.settings.globalValue("profileDir");

    // Backup Joplin settings
    await this.backupFile(
      path.join(profileDir, "settings.json"),
      path.join(activeBackupFolderProfile, "settings.json")
    );

    // Backup Keymap
    await this.backupFile(
      path.join(profileDir, "keymap-desktop.json"),
      path.join(activeBackupFolderProfile, "keymap-desktop.json")
    );

    // Backup userchrome.css
    await this.backupFile(
      path.join(profileDir, "userchrome.css"),
      path.join(activeBackupFolderProfile, "userchrome.css")
    );

    // Backup userstyle.css
    await this.backupFile(
      path.join(profileDir, "userstyle.css"),
      path.join(activeBackupFolderProfile, "userstyle.css")
    );

    // Backup Templates
    try {
      await this.backupFolder(
        await await joplin.settings.globalValue("templateDir"),
        path.join(activeBackupFolderProfile, "templates")
      );
    } catch (error) {
      this.log.info("No templateDir, Joplin >= v2.2.5");
    }
  }

  private async backupFolder(src: string, dst: string): Promise<boolean> {
    if (fs.existsSync(src)) {
      this.log.verbose("Copy " + src);
      try {
        fs.copySync(src, dst);
        return true;
      } catch (e) {
        await this.showError("backupFolder: " + e.message);
        throw e;
      }
    } else {
      this.log.info("no folder " + src);
      return false;
    }
  }

  private async backupFile(src: string, dest: string): Promise<boolean> {
    if (fs.existsSync(src)) {
      this.log.verbose("Copy " + src);
      try {
        fs.copyFileSync(src, dest);
        return true;
      } catch (e) {
        this.log.error("backupFile: " + e.message);
        throw e;
      }
    } else {
      this.log.verbose("No file '" + src);
      return false;
    }
  }

  private async moveFinishedBackup(zipFile: string = null): Promise<string> {
    this.log.info("Move finished backup");
    let backupDestination = null;
    if (this.backupRetention > 1) {
      const backupSetFolder = await this.getBackupSetFolderName();
      backupDestination = zipFile
        ? path.join(this.backupBasePath, backupSetFolder + ".7z")
        : path.join(this.backupBasePath, backupSetFolder);
      const src = zipFile ? zipFile : this.activeBackupPath;

      if (fs.existsSync(backupDestination)) {
        this.log.warn(`Backupset already exists: ${backupDestination}`);
        let ext = "";
        let name = path.basename(backupDestination);
        if (fs.statSync(backupDestination).isFile()) {
          ext = path.extname(backupDestination);
          name = name.replace(ext, "");
        }
        let nr = 0;
        let newBackupDestination = backupDestination;
        do {
          nr++;
          newBackupDestination = path.join(
            path.dirname(backupDestination),
            `${name} (${nr})${ext}`
          );
        } while (fs.existsSync(newBackupDestination));
        backupDestination = newBackupDestination;
        this.log.warn(`Backupset new name: ${backupDestination}`);
      }

      try {
        fs.moveSync(src, backupDestination);
      } catch (e) {
        await this.showError("moveFinishedBackup: " + e.message);
        throw e;
      }

      await this.saveBackupInfo(
        path.basename(backupDestination),
        this.backupStartTime.getTime()
      );
    } else {
      if (zipFile) {
        backupDestination = path.join(this.backupBasePath, "JoplinBackup.7z");
        try {
          fs.moveSync(zipFile, backupDestination);
        } catch (e) {
          await this.showError("moveFinishedBackup: " + e.message);
          throw e;
        }
      } else {
        backupDestination = this.backupBasePath;
        const oldBackupData = fs
          .readdirSync(this.activeBackupPath, { withFileTypes: true })
          .map((dirent) => dirent.name);
        for (const file of oldBackupData) {
          try {
            fs.moveSync(
              path.join(this.activeBackupPath, file),
              path.join(backupDestination, file)
            );
          } catch (e) {
            await this.showError("moveFinishedBackup: " + e.message);
            throw e;
          }
        }
      }

      try {
        fs.rmdirSync(this.activeBackupPath, {
          recursive: true,
        });
      } catch (e) {
        this.showError("moveFinishedBackup: " + e.message);
        throw e;
      }
    }

    return backupDestination;
  }

  private async clearBackupTarget(backupPath: string) {
    this.log.verbose(`Clear backup target`);

    // Remove only files
    const oldBackupData = fs
      .readdirSync(backupPath, { withFileTypes: true })
      .filter((dirent) => dirent.isFile())
      .map((dirent) => dirent.name)
      .reverse();
    for (const file of oldBackupData) {
      if (
        file !== path.basename(this.logFile) &&
        file !== "newJoplinBackup.7z"
      ) {
        try {
          fs.removeSync(path.join(backupPath, file));
        } catch (e) {
          await this.showError("" + e.message);
          throw e;
        }
      }
    }

    try {
      fs.removeSync(path.join(backupPath, "templates"));
    } catch (e) {
      await this.showError("deleteOldBackupSets" + e.message);
      throw e;
    }

    try {
      fs.removeSync(path.join(backupPath, "profile"));
    } catch (e) {
      await this.showError("deleteOldBackupSets" + e.message);
      throw e;
    }
  }

  private async deleteOldBackupSets(
    backupPath: string,
    backupRetention: number
  ) {
    this.log.verbose("deleteOldBackupSets");
    let info = JSON.parse(await joplin.settings.value("backupInfo"));
    let setOk = [];
    for (let check of info) {
      const folder = path.join(backupPath, check.name);
      if (fs.existsSync(folder)) {
        setOk.push(check);
      } else {
        this.log.verbose("Backup set " + folder + " no longer exist");
      }
    }
    await joplin.settings.setValue("backupInfo", JSON.stringify(setOk));
    info = JSON.parse(await joplin.settings.value("backupInfo"));
    if (info.length > backupRetention) {
      info.sort((a, b) => b.date - a.date);
    }

    while (info.length > backupRetention) {
      const del = info.splice(backupRetention, 1);
      const folder = path.join(backupPath, del[0].name);
      if (fs.existsSync(folder)) {
        this.log.verbose("Remove backup set " + folder);

        try {
          fs.rmdirSync(folder, {
            recursive: true,
          });
        } catch (e) {
          await this.showError("deleteOldBackupSets" + e.message);
          throw e;
        }
      }
      await joplin.settings.setValue("backupInfo", JSON.stringify(info));
    }
  }
}

export { Backup };
