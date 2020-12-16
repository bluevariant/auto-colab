module.exports = async function (state, run) {
  if (state === "connect") {
    // await run(page.click, page, "shadow/#connect");
    // await run(runDriveCell, null, run);
    // await IamStillAlive();
  }

  if (state === "connected") {
    await run(runDriveCell, null, run);
  }
};

async function runDriveCell(run) {
  let cells = await run(getCells);
  for (let cell of cells || []) {
    if (
      cell.lines &&
      cell.lines.length > 0 &&
      cell.lines.filter((v) => v.includes("drive.mount('/content/drive')")).length > 0
    ) {
      await run(cell.focus, cell);
      // await run(runFocusedCell);
      // await run(waitRunningCell, null, run, true);
      await run(wathCellOutput, null, run, cell.id);
      await run(mountDrive, null, cell.driveUrl, run);
      await run(waitForCellFree, null, run, cell.id);
    }
  }
  // let cellData = `from google.colab import drive
  // drive.mount('/content/drive')`;
}
