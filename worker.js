module.exports = async function (state, run) {
  if (state === "connect") {
    await run(page.click, page, "shadow/#connect");
  }

  if (state === "connected") {
    await run(runFistCell, null, run);
    await run(waitRunningCell, null, run, true);
    let cells = await run(getCells);
    for (let cell of cells || []) {
      if (cell.running && cell.driveUrl) {
        console.log("mounting...");
        await run(cell.focus, cell);
        await run(mountDrive, null, cell.driveUrl, run);
        await run(waitForCellFree, null, cell.id);
        console.log("mounting done");
      }
    }
  }
};

async function runFistCell(run) {
  let cells = await run(getCells);
  for (let cell of cells || []) {
    if (cell.lines && cell.lines.length > 0 && cell.lines[0].trim() === "#0") {
      await run(cell.focus, cell);
      await run(runFocusedCell);
    }
  }
}
