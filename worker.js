module.exports = async function (state, run) {
  if (state === "connect") {
    await run(execOnce, null, run, `!echo "i'm still alive"`, async (output) => {
      console.log("output", output);
      return true;
    });
  }

  if (state === "connected") {
    await run(runDriveCell, null, run);
  }
};

async function runDriveCell(run) {
  let code = `from google.colab import drive
drive.mount('/content/drive')`;
  await run(execOnce, null, run, code, async () => {
    let cells = await run(getCells);
    for (let cell of cells || []) {
      if (
        cell.lines &&
        cell.lines.length > 0 &&
        cell.lines.filter((v) => v.includes("drive.mount('/content/drive')")).length > 0
      ) {
        await run(mountDrive, null, cell.driveUrl, run);
        await run(waitForCellFree, null, run, cell.id);
        break;
      }
    }
    return true;
  });
}
