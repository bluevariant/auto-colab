module.exports = async function (state, controller) {
  // await loop(async () => {
  //   if (controller.canceled) {
  //     console.log("canceled:", state);
  //     return true;
  //   }
  // });
  if (state === "connected" || state === "busy") {
    // console.log(await getMachineId());
    await loop(async () => {
      let cells = await getCells();
      for (let i = 0; i < cells.length; i++) {
        let cell = cells[i];
        if (cell.running && cell.driveUrl) {
          await cell.focus();
          await submitDriveToken(cell.driveUrl);
          await sleep(1000000000);
        }
      }

      if (controller.canceled) {
        console.log("canceled:", state);
        return true;
      }
    });
  }
};
