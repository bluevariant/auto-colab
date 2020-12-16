const storage = {
  clickConnect: {},
};

module.exports = async function (state, run) {
  if (state === "connect") {
    if (!storage.clickConnect[global.uuid]) {
      await run(page.click, page, "shadow/#connect");
      storage.clickConnect[global.uuid] = true;
    }
  }

  if (state === "connected") {
    await cleanRunOnceCells();
    await run(waitAllCells, null, run);
    if (await run(runDriveCell, null, run)) {
      console.log("new runtime");
    } else {
      console.log("old runtime");
    }
  }
};

async function runDriveCell(run) {
  let isNew = false;
  let code = "from google.colab import drive\ndrive.mount('/content/drive')";
  await loop(async () => {
    if (await sessionEnded(run)) return true;
    let isMounted = false;
    await run(execOnce, null, run, "!test -e ./drive/MyDrive && echo connected || echo failed", (output) => {
      isMounted = output === "connected";
      return true;
    });
    if (isMounted) return true;
    await run(execOnce, null, run, code, async () => {
      let cells = await run(getCells);
      for (let cell of cells || []) {
        if (
          cell.lines &&
          cell.lines.length > 0 &&
          cell.lines.filter((v) => v.includes("drive.mount('/content/drive')")).length > 0 &&
          cell.driveUrl
        ) {
          await run(mountDrive, null, cell.driveUrl, run);
          await run(waitForCellFree, null, run, cell.id);
          isNew = true;
          break;
        }
      }
      return true;
    });
  }, 1000);
  return isNew;
}
