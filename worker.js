module.exports = async function (state, controller) {
  await loop(async () => {
    if (controller.canceled) {
      console.log("canceled:", state);
      return true;
    }
  });
};
