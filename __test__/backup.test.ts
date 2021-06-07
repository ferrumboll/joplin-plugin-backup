import { Backup } from "../src/Backup";
import * as fs from "fs-extra";
import * as path from "path";
import { joplinWrapper } from "../src/joplinWrapper";
import { when } from "jest-when";

function getTestPaths(): any {
  const testPath: any = {};
  testPath.base = path.join(__dirname, "tests");
  testPath.backupDest = path.join(testPath.base, "Backup");
  testPath.activeBackupJob = path.join(testPath.backupDest, "activeBackupJob");
  testPath.joplinProfile = path.join(testPath.base, "joplin-desktop");
  testPath.templates = path.join(testPath.joplinProfile, "templates");
  return testPath;
}

let backup = null;

const spyOnsSttingsValue = jest.spyOn(joplinWrapper, "settingsValue");
const spyOnGlobalValue = jest.spyOn(joplinWrapper, "settingsGlobalValue");

async function createTestStructure() {
  const test = await getTestPaths();
  fs.emptyDirSync(test.base);
  fs.emptyDirSync(test.backupDest);
  fs.emptyDirSync(test.joplinProfile);
  fs.emptyDirSync(test.templates);
}

const testPath = getTestPaths();

describe("Backup", function () {
  beforeEach(async () => {
    /* prettier-ignore */
    when(spyOnsSttingsValue)
      .mockImplementation(() => Promise.resolve("no mockImplementation"))
      .calledWith("fileLogLevel").mockImplementation(() => Promise.resolve("error"))
      .calledWith("path").mockImplementation(() => Promise.resolve(testPath.backupDest));

    /* prettier-ignore */
    when(spyOnGlobalValue)
      .mockImplementation(() => Promise.resolve("no mockImplementation"))
      .calledWith("profileDir").mockImplementation(() => Promise.resolve(testPath.joplinProfile))
      .calledWith("templateDir").mockImplementation(() => Promise.resolve(testPath.templates));

    await createTestStructure();
    backup = new Backup() as any;

    jest.spyOn(backup.log, "verbose").mockImplementation(() => {});
    jest.spyOn(backup.log, "info").mockImplementation(() => {});
    jest.spyOn(backup.log, "warn").mockImplementation(() => {});
    jest.spyOn(backup.log, "error").mockImplementation(() => {});
  });

  afterAll(async () => {
    fs.removeSync(testPath.base);
  });

  describe("Backup path", function () {
    it(`Backup path != Profile`, async () => {
      await backup.loadBackupPath();
      expect(backup.backupBasePath).toBe(testPath.backupDest);
      expect(backup.backupBasePath).not.toBe(testPath.joplinProfile);

      /* prettier-ignore */
      when(spyOnsSttingsValue)
      .calledWith("path").mockImplementation(() => Promise.resolve(""));
      await backup.loadBackupPath();
      expect(backup.backupBasePath).not.toBe(testPath.joplinProfile);
      expect(backup.backupBasePath).toBe(null);

      /* prettier-ignore */
      when(spyOnsSttingsValue)
      .calledWith("path").mockImplementation(() => Promise.resolve(testPath.joplinProfile));
      await backup.loadBackupPath();
      expect(backup.backupBasePath).not.toBe(testPath.joplinProfile);
      expect(backup.backupBasePath).toBe(null);

      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });

    it(`relative paths`, async () => {
      const backupPath = "../";
      /* prettier-ignore */
      when(spyOnsSttingsValue)
      .calledWith("path").mockImplementation(() => Promise.resolve(backupPath));
      await backup.loadBackupPath();
      const toBe = path.normalize(path.join(testPath.backupDest, backupPath));
      expect(backup.backupBasePath).toBe(toBe);
      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });
  });

  describe("Div", function () {
    it(`Create empty folder`, async () => {
      const folder = await backup.createEmptyFolder(
        testPath.backupDest,
        "profile"
      );
      const check = path.join(testPath.backupDest, "profile");
      expect(folder).toBe(check);
      expect(fs.existsSync(check)).toBe(true);
      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });

    it(`Delete log`, async () => {
      backup.logFile = path.join(testPath.backupDest, "test.log");
      fs.writeFileSync(backup.logFile, "data");

      expect(fs.existsSync(backup.logFile)).toBe(true);
      await backup.deleteLogFile();
      expect(fs.existsSync(backup.logFile)).toBe(false);
      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });

    it(`Get Retention folder name`, async () => {
      const testEpoch = new Date(2021, 0, 2, 16, 30, 45, 0).getTime();
      const spyOnDateNow = jest
        .spyOn(Date, "now")
        .mockImplementation(() => testEpoch);
      expect(await backup.getBackupSetFolderName()).toBe("202101021630");
      spyOnDateNow.mockRestore();
      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });

    it(`moveFinishedBackup no retention`, async () => {
      const emptyFolder = path.join(testPath.activeBackupJob, "emptyFolder");
      const emptyFolderCheck = path.join(testPath.backupDest, "emptyFolder");
      const folder = path.join(testPath.activeBackupJob, "folder");
      const folderCheck = path.join(testPath.backupDest, "folder");
      const file1 = path.join(folder, "file.txt");
      const file1Check = path.join(folderCheck, "file.txt");
      const file2 = path.join(testPath.activeBackupJob, "file.txt");
      const file2Check = path.join(testPath.backupDest, "file.txt");
      backup.backupBasePath = testPath.backupDest;
      backup.activeBackupPath = testPath.activeBackupJob;

      fs.emptyDirSync(testPath.activeBackupJob);
      fs.emptyDirSync(emptyFolder);
      fs.emptyDirSync(folder);
      fs.writeFileSync(file1, "file");
      fs.writeFileSync(file2, "file");

      expect(await backup.moveFinishedBackup()).toBe(testPath.backupDest);
      expect(fs.existsSync(folderCheck)).toBe(true);
      expect(fs.existsSync(emptyFolderCheck)).toBe(true);
      expect(fs.existsSync(file1Check)).toBe(true);
      expect(fs.existsSync(file2Check)).toBe(true);
      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });
  });

  describe("Logging", function () {
    beforeEach(async () => {
      backup.setupLog();
    });

    it(`Default`, async () => {
      expect(backup.log.transports.console.level).toBe("verbose");
      expect(backup.log.transports.file.level).toBe(false);
    });

    it(`Toggel file`, async () => {
      await backup.fileLogging(false);
      expect(backup.log.transports.file.level).toBe(false);

      /* prettier-ignore */
      when(spyOnsSttingsValue)
        .calledWith("fileLogLevel").mockImplementation(() => Promise.resolve("verbose"));

      backup.backupBasePath = "./";
      await backup.fileLogging(true);
      expect(backup.log.transports.file.level).toBe("verbose");

      /* prettier-ignore */
      when(spyOnsSttingsValue)
        .calledWith("fileLogLevel").mockImplementation(() => Promise.resolve("error"));

      backup.backupBasePath = "./";
      await backup.fileLogging(true);
      expect(backup.log.transports.file.level).toBe("error");
    });
  });

  describe("Backup", function () {
    it(`File`, async () => {
      const src1 = path.join(testPath.joplinProfile, "settings.json");
      const src2 = path.join(testPath.joplinProfile, "doesNotExist.json");
      const dst = path.join(testPath.backupDest, "settings.json");
      fs.writeFileSync(src1, "data");

      expect(await backup.backupFile(src1, dst)).toBe(true);
      expect(fs.existsSync(dst)).toBe(true);

      expect(await backup.backupFile(src2, dst)).toBe(false);

      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });

    it(`Folder`, async () => {
      const file1 = path.join(testPath.templates, "template1.md");
      const file2 = path.join(testPath.templates, "template2.md");

      const doesNotExist = path.join(testPath.base, "doesNotExist");

      const dst = path.join(testPath.backupDest, "templates");
      const checkFile1 = path.join(dst, "template1.md");
      const checkFile2 = path.join(dst, "template2.md");

      fs.writeFileSync(file1, "template1");
      fs.writeFileSync(file2, "template2");

      expect(await backup.backupFolder(testPath.templates, dst)).toBe(true);
      expect(fs.existsSync(checkFile1)).toBe(true);
      expect(fs.existsSync(checkFile2)).toBe(true);

      expect(await backup.backupFolder(doesNotExist, dst)).toBe(false);

      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });

    it(`Profile`, async () => {
      const template = path.join(testPath.templates, "template1.md");
      const settings = path.join(testPath.joplinProfile, "settings.json");
      const userstyle = path.join(testPath.joplinProfile, "userstyle.css");
      const userchrome = path.join(testPath.joplinProfile, "userchrome.css");
      const keymap = path.join(testPath.joplinProfile, "keymap-desktop.json");

      fs.writeFileSync(template, "template");
      fs.writeFileSync(settings, "settings");
      fs.writeFileSync(userstyle, "userstyle");
      fs.writeFileSync(userchrome, "userchrome");
      fs.writeFileSync(keymap, "keymap");

      fs.emptyDirSync(testPath.activeBackupJob);

      const backupTemplate = path.join(
        testPath.activeBackupJob,
        "profile",
        "templates",
        "template1.md"
      );
      const backupSettings = path.join(
        testPath.activeBackupJob,
        "profile",
        "settings.json"
      );
      const backupUserstyle = path.join(
        testPath.activeBackupJob,
        "profile",
        "userstyle.css"
      );
      const backupUserchrome = path.join(
        testPath.activeBackupJob,
        "profile",
        "userchrome.css"
      );
      const backupKeymap = path.join(
        testPath.activeBackupJob,
        "profile",
        "keymap-desktop.json"
      );

      backup.activeBackupPath = testPath.activeBackupJob;
      await backup.backupProfileData();

      expect(fs.existsSync(backupTemplate)).toBe(true);
      expect(fs.existsSync(backupSettings)).toBe(true);
      expect(fs.existsSync(backupUserstyle)).toBe(true);
      expect(fs.existsSync(backupUserchrome)).toBe(true);
      expect(fs.existsSync(backupKeymap)).toBe(true);

      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });
  });
});
