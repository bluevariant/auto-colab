module.exports = async function (state, controller) {
  // await loop(async () => {
  //   if (controller.canceled) {
  //     console.log("canceled:", state);
  //     return true;
  //   }
  // });
  if (state === "connected") {
    console.log(await getCells());
    // console.log(await getMachineId());
  }

  if (state === "busy") {
    console.log(await getCells());
  }
};
