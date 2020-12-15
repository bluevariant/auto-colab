module.exports = async function (state, controller) {
  await loop(async () => {
    if (controller.canceled) {
      console.log("canceled:", state);
      return true;
    }
  });
};

/**
 *
 */

async function loop(fn, ms = 33) {
  while (true) {
    let val = await fn();
    if (val !== undefined) return val;
    await sleep(ms);
  }
}

function sleep(ms) {
  return new Promise((rel) => setTimeout(rel, ms));
}
