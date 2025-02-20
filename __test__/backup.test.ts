import { Backup } from "../src/Backup";
import * as fs from "fs-extra";
import * as path from "path";
import { when } from "jest-when";
import { sevenZip } from "../src/sevenZip";
import joplin from "api";

function getTestPaths(): any {
  const testPath: any = {};
  testPath.base = path.join(__dirname, "tests");
  testPath.backupBasePath = path.join(testPath.base, "Backup");
  testPath.activeBackupJob = path.join(
    testPath.backupBasePath,
    "activeBackupJob"
  );
  testPath.joplinProfile = path.join(testPath.base, "joplin-desktop");
  testPath.templates = path.join(testPath.joplinProfile, "templates");
  return testPath;
}

let backup = null;

let spyOnLogVerbose = null;
let spyOnLogInfo = null;
let spyOnLogWarn = null;
let spyOnLogError = null;
let spyOnSaveBackupInfo = null;

const spyOnsSettingsValue = jest.spyOn(joplin.settings, "value");
const spyOnGlobalValue = jest.spyOn(joplin.settings, "globalValue");
const spyOnSettingsSetValue = jest
  .spyOn(joplin.settings, "setValue")
  .mockImplementation();

async function createTestStructure() {
  const test = await getTestPaths();
  fs.emptyDirSync(test.base);
  fs.emptyDirSync(test.backupBasePath);
  fs.emptyDirSync(test.joplinProfile);
  fs.emptyDirSync(test.templates);
}

const testPath = getTestPaths();

describe("Backup", function () {
  beforeEach(async () => {
    /* prettier-ignore */
    when(spyOnsSettingsValue)
      .mockImplementation(() => Promise.resolve("no mockImplementation"))
      .calledWith("fileLogLevel").mockImplementation(() => Promise.resolve("error"))
      .calledWith("path").mockImplementation(() => Promise.resolve(testPath.backupBasePath));

    /* prettier-ignore */
    when(spyOnGlobalValue)
      .mockImplementation(() => Promise.resolve("no mockImplementation"))
      .calledWith("profileDir").mockImplementation(() => Promise.resolve(testPath.joplinProfile))
      .calledWith("templateDir").mockImplementation(() => Promise.resolve(testPath.templates));

    await createTestStructure();
    backup = new Backup() as any;
    backup.backupStartTime = new Date();
    backup.backupSetName = "{YYYYMMDDHHmm}";

    spyOnSaveBackupInfo = jest
      .spyOn(backup, "saveBackupInfo")
      .mockImplementation(() => {});

    spyOnLogVerbose = jest
      .spyOn(backup.log, "verbose")
      .mockImplementation(() => {});
    spyOnLogInfo = jest.spyOn(backup.log, "info").mockImplementation(() => {});
    spyOnLogWarn = jest.spyOn(backup.log, "warn").mockImplementation(() => {});
    spyOnLogError = jest
      .spyOn(backup.log, "error")
      .mockImplementation(() => {});
  });

  afterEach(async () => {
    spyOnLogVerbose.mockReset();
    spyOnLogInfo.mockReset();
    spyOnLogWarn.mockReset();
    spyOnLogError.mockReset();
    spyOnsSettingsValue.mockReset();
    spyOnGlobalValue.mockReset();
    spyOnSaveBackupInfo.mockReset();
  });

  afterAll(async () => {
    fs.removeSync(testPath.base);
  });

  describe("Backup path", function () {
    it(`Backup path != Profile`, async () => {
      await backup.loadBackupPath();
      expect(backup.backupBasePath).toBe(testPath.backupBasePath);
      expect(backup.backupBasePath).not.toBe(testPath.joplinProfile);

      /* prettier-ignore */
      when(spyOnsSettingsValue)
      .calledWith("path").mockImplementation(() => Promise.resolve(""));
      await backup.loadBackupPath();
      expect(backup.backupBasePath).not.toBe(testPath.joplinProfile);
      expect(backup.backupBasePath).toBe(null);

      /* prettier-ignore */
      when(spyOnsSettingsValue)
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
      when(spyOnsSettingsValue)
      .calledWith("path").mockImplementation(() => Promise.resolve(backupPath));
      await backup.loadBackupPath();
      const toBe = path.normalize(
        path.join(testPath.backupBasePath, backupPath)
      );
      expect(backup.backupBasePath).toBe(toBe);
      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });
  });

  describe("Div", function () {
    it(`Create empty folder`, async () => {
      const folder = await backup.createEmptyFolder(
        testPath.backupBasePath,
        "profile"
      );
      const check = path.join(testPath.backupBasePath, "profile");
      expect(folder).toBe(check);
      expect(fs.existsSync(check)).toBe(true);
      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });

    it(`Delete log`, async () => {
      backup.logFile = path.join(testPath.backupBasePath, "test.log");
      fs.writeFileSync(backup.logFile, "data");

      expect(fs.existsSync(backup.logFile)).toBe(true);
      await backup.deleteLogFile();
      expect(fs.existsSync(backup.logFile)).toBe(false);
      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });
  });

  describe("moveFinishedBackup", function () {
    it(`no retention`, async () => {
      const emptyFolder = path.join(testPath.activeBackupJob, "emptyFolder");
      const emptyFolderCheck = path.join(
        testPath.backupBasePath,
        "emptyFolder"
      );
      const folder = path.join(testPath.activeBackupJob, "folder");
      const folderCheck = path.join(testPath.backupBasePath, "folder");
      const file1 = path.join(folder, "file.txt");
      const file1Check = path.join(folderCheck, "file.txt");
      const file2 = path.join(testPath.activeBackupJob, "file.txt");
      const file2Check = path.join(testPath.backupBasePath, "file.txt");
      backup.backupBasePath = testPath.backupBasePath;
      backup.activeBackupPath = testPath.activeBackupJob;

      fs.emptyDirSync(testPath.activeBackupJob);
      fs.emptyDirSync(emptyFolder);
      fs.emptyDirSync(folder);
      fs.writeFileSync(file1, "file");
      fs.writeFileSync(file2, "file");

      backup.backupRetention = 1;

      expect(await backup.moveFinishedBackup()).toBe(testPath.backupBasePath);
      expect(fs.existsSync(folderCheck)).toBe(true);
      expect(fs.existsSync(emptyFolderCheck)).toBe(true);
      expect(fs.existsSync(file1Check)).toBe(true);
      expect(fs.existsSync(file2Check)).toBe(true);
      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });

    it(`retention > 1`, async () => {
      const backupDst = path.join(testPath.backupBasePath, "202101021630");
      const testEpoch = new Date(2021, 0, 2, 16, 30, 45, 0).getTime();
      const spyOnDateNow = jest
        .spyOn(Date, "now")
        .mockImplementation(() => testEpoch);

      const emptyFolder = path.join(testPath.activeBackupJob, "emptyFolder");
      const emptyFolderCheck = path.join(backupDst, "emptyFolder");
      const folder = path.join(testPath.activeBackupJob, "folder");
      const folderCheck = path.join(backupDst, "folder");
      const file1 = path.join(folder, "file.txt");
      const file1Check = path.join(folderCheck, "file.txt");
      const file2 = path.join(testPath.activeBackupJob, "file.txt");
      const file2Check = path.join(backupDst, "file.txt");
      backup.backupBasePath = testPath.backupBasePath;
      backup.activeBackupPath = testPath.activeBackupJob;

      fs.emptyDirSync(testPath.activeBackupJob);
      fs.emptyDirSync(emptyFolder);
      fs.emptyDirSync(folder);
      fs.writeFileSync(file1, "file");
      fs.writeFileSync(file2, "file");

      backup.backupRetention = 2;

      expect(await backup.moveFinishedBackup()).toBe(backupDst);
      expect(fs.existsSync(folderCheck)).toBe(true);
      expect(fs.existsSync(emptyFolderCheck)).toBe(true);
      expect(fs.existsSync(file1Check)).toBe(true);
      expect(fs.existsSync(file2Check)).toBe(true);
      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);

      spyOnDateNow.mockRestore();
    });

    it(`retention > 1, folder exist`, async () => {
      backup.backupBasePath = testPath.backupBasePath;
      backup.activeBackupPath = testPath.activeBackupJob;
      backup.backupSetName = "JoplinBackupSet";
      backup.backupRetention = 2;

      const expected = path.join(
        testPath.backupBasePath,
        backup.backupSetName + " (1)"
      );

      fs.emptyDirSync(testPath.activeBackupJob);
      const existingBackupSet = path.join(
        testPath.backupBasePath,
        backup.backupSetName
      );
      fs.emptyDirSync(existingBackupSet);
      expect(fs.existsSync(existingBackupSet)).toBe(true);

      expect(fs.existsSync(expected)).toBe(false);
      expect(await backup.moveFinishedBackup()).toBe(expected);
      expect(fs.existsSync(expected)).toBe(true);
    });

    it(`retention > 1, file exist`, async () => {
      backup.backupBasePath = testPath.backupBasePath;
      backup.activeBackupPath = testPath.activeBackupJob;
      backup.backupSetName = "JoplinBackupSet";
      backup.backupRetention = 2;

      const zipFile = path.join(testPath.backupBasePath, "test.7z");
      fs.writeFileSync(zipFile, "backup set");
      expect(fs.existsSync(zipFile)).toBe(true);

      const expected = path.join(
        testPath.backupBasePath,
        backup.backupSetName + " (1).7z"
      );

      fs.emptyDirSync(testPath.activeBackupJob);
      const existingBackupSet = path.join(
        testPath.backupBasePath,
        backup.backupSetName + ".7z"
      );
      fs.writeFileSync(existingBackupSet, "backup set");
      expect(fs.existsSync(existingBackupSet)).toBe(true);

      expect(fs.existsSync(expected)).toBe(false);
      expect(await backup.moveFinishedBackup(zipFile)).toBe(expected);
      expect(fs.existsSync(expected)).toBe(true);
    });
  });
  describe("Backup set", function () {
    it(`Name`, async () => {
      const testEpoch = new Date(2021, 0, 2, 16, 30, 45, 0).getTime();
      /* prettier-ignore */
      const spyOnDateNow = jest.spyOn(Date, "now").mockImplementation(() => testEpoch);

      const testCases = [
        {
          backupSetName: "{YYYYMMDDHHmm}",
          expected: "202101021630",
        },
        {
          backupSetName: "{YYYY-MM-DD HH:mm}",
          expected: "2021-01-02 16:30",
        },
        {
          backupSetName: "Joplinbackup_{YYYYMMDDHHmm}",
          expected: "Joplinbackup_202101021630",
        },
        {
          backupSetName: "A {YYYY} b {MMDDHHmm}",
          expected: "A 2021 b 01021630",
        },
        {
          backupSetName: "j{j}j",
          expected: "jjj",
        },
        {
          backupSetName: "No var",
          expected: "No var",
        },
      ];

      for (const testCase of testCases) {
        backup.backupSetName = testCase.backupSetName;
        expect(await backup.getBackupSetFolderName()).toBe(testCase.expected);
      }

      spyOnDateNow.mockRestore();
      expect(backup.log.error).toHaveBeenCalledTimes(0);
      expect(backup.log.warn).toHaveBeenCalledTimes(0);
    });

    it(`Creation`, async () => {
      const testEpoch = new Date(2021, 0, 2, 16, 30, 45, 0);
      const spyOnDateNow = jest
        .spyOn(Date, "now")
        .mockImplementation(() => testEpoch.getTime());

      const testCases = [
        {
          zipArchive: "no",
          backupRetention: 1,
          password: null,
          singleJex: false,
          result: testPath.backupBasePath,
          testFile: "testFile.txt",
          checkFile: path.join(testPath.backupBasePath, "testFile.txt"),
          saveBackupInfoCalled: 0,
        },
        {
          zipArchive: "no",
          backupRetention: 1,
          password: "secret",
          singleJex: false,
          result: testPath.backupBasePath,
          testFile: "testFile.txt",
          checkFile: path.join(testPath.backupBasePath, "testFile.txt.7z"),
          saveBackupInfoCalled: 0,
        },
        {
          zipArchive: "no",
          backupRetention: 2,
          password: null,
          singleJex: false,
          result: path.join(testPath.backupBasePath, "202101021630"),
          testFile: "testFile.txt",
          checkFile: path.join(
            testPath.backupBasePath,
            "202101021630",
            "testFile.txt"
          ),
          saveBackupInfoCalled: 1,
        },
        {
          zipArchive: "yes",
          backupRetention: 1,
          password: null,
          singleJex: false,
          result: testPath.backupBasePath,
          testFile: "testFile.txt",
          checkFile: path.join(testPath.backupBasePath, "testFile.txt.7z"),
          saveBackupInfoCalled: 0,
        },
        {
          zipArchive: "yes",
          backupRetention: 2,
          password: null,
          singleJex: false,
          result: path.join(testPath.backupBasePath, "202101021630"),
          testFile: "testFile.txt",
          checkFile: path.join(
            testPath.backupBasePath,
            "202101021630",
            "testFile.txt.7z"
          ),
          saveBackupInfoCalled: 1,
        },
        {
          zipArchive: "yesone",
          backupRetention: 1,
          password: null,
          singleJex: false,
          result: path.join(testPath.backupBasePath, "JoplinBackup.7z"),
          testFile: "testFile.txt",
          checkFile: path.join(testPath.backupBasePath, "JoplinBackup.7z"),
          saveBackupInfoCalled: 0,
        },
        {
          zipArchive: "yesone",
          backupRetention: 2,
          password: null,
          singleJex: false,
          result: path.join(testPath.backupBasePath, "202101021630.7z"),
          testFile: "testFile.txt",
          checkFile: path.join(testPath.backupBasePath, "202101021630.7z"),
          saveBackupInfoCalled: 1,
        },
        {
          zipArchive: "no",
          backupRetention: 1,
          password: null,
          singleJex: true,
          result: testPath.backupBasePath,
          testFile: "testFile.txt",
          checkFile: path.join(testPath.backupBasePath, "testFile.txt"),
          saveBackupInfoCalled: 0,
        },
        {
          zipArchive: "no",
          backupRetention: 2,
          password: null,
          singleJex: true,
          result: path.join(testPath.backupBasePath, "202101021630"),
          testFile: "testFile.txt",
          checkFile: path.join(
            testPath.backupBasePath,
            "202101021630",
            "testFile.txt"
          ),
          saveBackupInfoCalled: 1,
        },
        {
          zipArchive: "yes",
          backupRetention: 1,
          password: null,
          singleJex: true,
          result: path.join(testPath.backupBasePath, "JoplinBackup.7z"),
          testFile: "testFile.txt",
          checkFile: path.join(testPath.backupBasePath, "JoplinBackup.7z"),
          saveBackupInfoCalled: 0,
        },
        {
          zipArchive: "yes",
          backupRetention: 2,
          password: null,
          singleJex: true,
          result: path.join(testPath.backupBasePath, "202101021630.7z"),
          testFile: "testFile.txt",
          checkFile: path.join(testPath.backupBasePath, "202101021630.7z"),
          saveBackupInfoCalled: 1,
        },
        {
          zipArchive: "yesone",
          backupRetention: 1,
          password: null,
          singleJex: true,
          result: path.join(testPath.backupBasePath, "JoplinBackup.7z"),
          testFile: "testFile.txt",
          checkFile: path.join(testPath.backupBasePath, "JoplinBackup.7z"),
          saveBackupInfoCalled: 0,
        },
        {
          zipArchive: "yesone",
          backupRetention: 1,
          password: "secret",
          singleJex: true,
          result: path.join(testPath.backupBasePath, "JoplinBackup.7z"),
          testFile: "testFile.txt",
          checkFile: path.join(testPath.backupBasePath, "JoplinBackup.7z"),
          saveBackupInfoCalled: 0,
        },
        {
          zipArchive: "yesone",
          backupRetention: 2,
          password: null,
          singleJex: true,
          result: path.join(testPath.backupBasePath, "202101021630.7z"),
          testFile: "testFile.txt",
          checkFile: path.join(testPath.backupBasePath, "202101021630.7z"),
          saveBackupInfoCalled: 1,
        },
      ];

      backup.backupBasePath = testPath.backupBasePath;
      backup.activeBackupPath = testPath.activeBackupJob;
      backup.backupStartTime = testEpoch;
      backup.logFile = path.join(testPath.backupBasePath, "test.log");

      /* prettier-ignore */
      when(spyOnsSettingsValue)
            .calledWith("backupInfo").mockImplementation(() => Promise.resolve(JSON.stringify([])));
      jest.spyOn(backup, "saveBackupInfo").mockImplementation(() => {});

      for (const testCase of testCases) {
        await createTestStructure();
        fs.emptyDirSync(testPath.activeBackupJob);
        const fileName = testCase.testFile;
        const file = path.join(testPath.activeBackupJob, fileName);
        fs.writeFileSync(file, "testFile");
        expect(fs.existsSync(file)).toBe(true);

        backup.zipArchive = testCase.zipArchive;
        backup.backupRetention = testCase.backupRetention;
        backup.singleJex = testCase.singleJex;
        backup.passwordEnabled = testCase.password === null ? false : true;
        backup.password = testCase.password;

        const result = await backup.makeBackupSet();
        expect(result).toBe(testCase.result);
        expect(fs.existsSync(testCase.checkFile)).toBe(true);
        expect(backup.saveBackupInfo).toHaveBeenCalledTimes(
          testCase.saveBackupInfoCalled
        );
        const pwCheck = await sevenZip.passwordProtected(testCase.checkFile);
        if (backup.passwordEnabled === true || testCase.zipArchive !== "no") {
          expect(pwCheck).toBe(backup.passwordEnabled);
        }

        backup.saveBackupInfo.mockReset();
        fs.emptyDirSync(testPath.activeBackupJob);
        expect(fs.existsSync(file)).toBe(false);
      }

      spyOnDateNow.mockRestore();
    });
  });

  describe("Backup retention", function () {
    it(`Backups < retention`, async () => {
      const backupRetention = 3;
      const folder1 = path.join(testPath.backupBasePath, "202101011630");
      const folder2 = path.join(testPath.backupBasePath, "202101021630");

      fs.emptyDirSync(folder1);
      fs.emptyDirSync(folder2);

      const backupInfo = [
        { name: "202101011630", date: 1 },
        { name: "202101021630", date: 2 },
      ];
      /* prettier-ignore */
      when(spyOnsSettingsValue)
            .calledWith("backupInfo").mockImplementation(() => Promise.resolve(JSON.stringify(backupInfo)));

      backup.deleteOldBackupSets(testPath.backupBasePath, backupRetention);

      const folderAnz = fs
        .readdirSync(testPath.backupBasePath, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory()).length;

      expect(folderAnz).toBe(2);

      expect(fs.existsSync(folder1)).toBe(true);
      expect(fs.existsSync(folder2)).toBe(true);
    });

    it(`Backups = retention`, async () => {
      const backupRetention = 3;
      const folder1 = path.join(testPath.backupBasePath, "202101011630");
      const folder2 = path.join(testPath.backupBasePath, "202101021630");
      const folder3 = path.join(testPath.backupBasePath, "202101031630");

      fs.emptyDirSync(folder1);
      fs.emptyDirSync(folder2);
      fs.emptyDirSync(folder3);

      const backupInfo = [
        { name: "202101011630", date: 1 },
        { name: "202101021630", date: 2 },
        { name: "202101031630", date: 3 },
      ];
      /* prettier-ignore */
      when(spyOnsSettingsValue)
            .calledWith("backupInfo").mockImplementation(() => Promise.resolve(JSON.stringify(backupInfo)));

      backup.deleteOldBackupSets(testPath.backupBasePath, backupRetention);
      const folderAnz = fs
        .readdirSync(testPath.backupBasePath, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory()).length;

      expect(folderAnz).toBe(3);

      expect(fs.existsSync(folder1)).toBe(true);
      expect(fs.existsSync(folder2)).toBe(true);
      expect(fs.existsSync(folder3)).toBe(true);
    });

    it(`Backups > retention`, async () => {
      const backupRetention = 3;
      const folder1 = path.join(testPath.backupBasePath, "202101011630");
      const folder2 = path.join(testPath.backupBasePath, "202101021630");
      const folder3 = path.join(testPath.backupBasePath, "202101031630");
      const folder4 = path.join(testPath.backupBasePath, "202101041630");
      const folder5 = path.join(testPath.backupBasePath, "202101051630");

      fs.emptyDirSync(folder1);
      fs.emptyDirSync(folder2);
      fs.emptyDirSync(folder3);
      fs.emptyDirSync(folder4);
      fs.emptyDirSync(folder5);

      const backupInfo = [
        { name: "202101011630", date: 1 },
        { name: "202101021630", date: 2 },
        { name: "202101031630", date: 3 },
        { name: "202101041630", date: 4 },
        { name: "202101051630", date: 5 },
      ];
      /* prettier-ignore */
      when(spyOnsSettingsValue)
            .calledWith("backupInfo").mockImplementation(() => Promise.resolve(JSON.stringify(backupInfo)));

      await backup.deleteOldBackupSets(
        testPath.backupBasePath,
        backupRetention
      );

      const folderAnz = fs
        .readdirSync(testPath.backupBasePath, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory()).length;

      expect(folderAnz).toBe(3);
      expect(fs.existsSync(folder1)).toBe(false);
      expect(fs.existsSync(folder2)).toBe(false);
      expect(fs.existsSync(folder3)).toBe(true);
      expect(fs.existsSync(folder4)).toBe(true);
      expect(fs.existsSync(folder5)).toBe(true);
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
      when(spyOnsSettingsValue)
        .calledWith("fileLogLevel").mockImplementation(() => Promise.resolve("verbose"));

      backup.backupBasePath = "./";
      await backup.fileLogging(true);
      expect(backup.log.transports.file.level).toBe("verbose");

      /* prettier-ignore */
      when(spyOnsSettingsValue)
        .calledWith("fileLogLevel").mockImplementation(() => Promise.resolve("error"));

      backup.backupBasePath = "./";
      await backup.fileLogging(true);
      expect(backup.log.transports.file.level).toBe("error");
    });

    it(`move logfile`, async () => {
      const testCases = [
        {
          zipArchive: "no",
          password: null,
          logDst: testPath.backupBasePath,
          testLogFile: path.join(testPath.backupBasePath, "backup.log"),
        },
        {
          zipArchive: "no",
          password: null,
          logDst: path.join(testPath.backupBasePath, "testDir"),
          testLogFile: path.join(
            testPath.backupBasePath,
            "testDir",
            "backup.log"
          ),
        },
        {
          zipArchive: "yes",
          password: null,
          logDst: path.join(testPath.backupBasePath, "testDir"),
          testLogFile: path.join(
            testPath.backupBasePath,
            "testDir",
            "backup.log"
          ),
        },
        {
          zipArchive: "yesone",
          password: null,
          logDst: path.join(testPath.backupBasePath, "Backup.7z"),
          testLogFile: "backup.log",
        },
        {
          zipArchive: "yesone",
          password: "secret",
          logDst: path.join(testPath.backupBasePath, "Backup.7z"),
          testLogFile: "backup.log",
        },
        {
          zipArchive: "no",
          password: "secret",
          logDst: testPath.backupBasePath,
          testLogFile: "backup.log",
        },
      ];

      backup.logFile = path.join(testPath.base, "test.log");
      for (const testCase of testCases) {
        await createTestStructure();
        if (testCase.zipArchive !== "yesone") {
          fs.emptyDirSync(testCase.logDst);
        }
        if (testCase.zipArchive === "yesone") {
          const dummyFile = path.join(testPath.base, "dummy");
          fs.writeFileSync(dummyFile, "dummy");
          await sevenZip.add(testCase.logDst, dummyFile, testCase.password);
          expect(fs.existsSync(dummyFile)).toBe(true);
          expect(fs.existsSync(testCase.logDst)).toBe(true);
        }

        fs.writeFileSync(backup.logFile, "log");

        backup.zipArchive = testCase.zipArchive;
        backup.password = testCase.password;

        expect(fs.existsSync(backup.logFile)).toBe(true);
        expect(await backup.moveLogFile(testCase.logDst)).toBe(true);
        expect(fs.existsSync(backup.logFile)).toBe(false);

        if (testCase.password !== null || testCase.zipArchive === "yesone") {
          const fileList = await sevenZip.list(
            testCase.logDst,
            testCase.password
          );
          expect(fileList.map((f) => f.file)).toContain(testCase.testLogFile);
        } else {
          expect(fs.existsSync(testCase.testLogFile)).toBe(true);
        }
      }
    });
  });

  describe("Backup action", function () {
    it(`File`, async () => {
      const src1 = path.join(testPath.joplinProfile, "settings.json");
      const src2 = path.join(testPath.joplinProfile, "doesNotExist.json");
      const dst = path.join(testPath.backupBasePath, "settings.json");
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

      const dst = path.join(testPath.backupBasePath, "templates");
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
