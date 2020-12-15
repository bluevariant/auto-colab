const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteerExtra.use(StealthPlugin());
const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const path = require("path");
const slug = require("slug");
const { QueryHandler } = require("query-selector-shadow-dom/plugins/puppeteer");
const Queue = require("better-queue");
const myWorker = require("./worker");

const DATA_DIR = path.join(__dirname, "data");
const BROWSER_OPTIONS = {
  headless: false,
  ignoreDefaultArgs: true,
  args: ["--start-maximized", "--disable-infobars"],
  defaultViewport: null,
};
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15";
const URL = "https://colab.research.google.com/drive/10oSUbDkLeMbH04bi2pJwMuIaxWJ8jE2m";

// from google.colab import drive
// drive.mount('/content/drive')

const worker = new Queue(
  function (params, cb) {
    console.log("state:", params.state);

    let controller = { canceled: false };
    try {
      myWorker(params.state, controller).then(() => cb(null));
    } catch (e) {
      console.error(e);
      cb(null);
    }
    return { cancel: () => (controller.canceled = true) };
  },
  { id: "id", cancelIfRunning: true }
);

(async () => {
  let accounts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "accounts.json"), "UTF-8") || "[]");
  let userDataDir = path.join(DATA_DIR, "users", slug(accounts[0].login));
  fs.ensureDirSync(userDataDir);

  await puppeteer.registerCustomQueryHandler("shadow", QueryHandler);
  let browser = await puppeteer.launch(BROWSER_OPTIONS);
  let page = await login(browser, URL, accounts[0].login, accounts[0].password, userDataDir, BROWSER_OPTIONS);
  await page.waitForSelector("shadow/.cell.code");

  global.page = page;

  let lastState = undefined;
  await loop(async () => {
    let state;
    try {
      state = await page.$eval("shadow/#connect", (elm) => elm.innerText);
      state = slug(state);
      if (state === "ram-disk") {
        state = "connected";
      }
      if (!["connect", "allocating", "connecting", "initializing", "connected", "busy"].includes(state)) {
        state = undefined;
      }
    } catch (e) {}
    if (state) {
      if (lastState !== state) {
        worker.push({ id: 1, state });
        lastState = state;
      }
    }
  });

  // let cells = await page.$$eval("shadow/.cell.code", (elements) =>
  //   elements.map((elm) => {
  //     let rect = elm.getBoundingClientRect();
  //     return {
  //       x: rect.x,
  //       y: rect.y,
  //       width: rect.width,
  //       height: rect.height,
  //       centerX: (rect.x + rect.right) / 2,
  //       centerY: (rect.y + rect.bottom) / 2,
  //       text: elm.innerText,
  //       html: elm.html,
  //       id: elm.getAttribute("id"),
  //     };
  //   })
  // );
  // await page.click("shadow/#" + cells[0].id);
  // await page.keyboard.down("Control");
  // await sleep(100);
  // await page.keyboard.press("Enter");
  // await sleep(100);
  // await page.keyboard.up("Control");
  // console.log(cells);
})();

async function login(browser, url, account, password, userDataDir, browserOptions, loginAction) {
  const page = (await browser.pages())[0];
  await loadCookies(page, userDataDir);
  await page.setUserAgent(USER_AGENT);
  await page.goto(url);
  let needLogin = false;
  await loop(async () => {
    let check = await page.evaluate((_) => {
      let loginElm = document.querySelector("#identifierId");
      let colabElm = document.querySelector("#share");
      if (loginElm) return "login";
      if (colabElm) return "colab";
      return null;
    });
    if (check) {
      needLogin = check === "login";
      return true;
    }
  });
  if (needLogin) {
    if (loginAction) {
      await page.waitForSelector("#identifierId");
      await page.type("#identifierId", account);
      await page.click("#identifierNext");
      await page.waitForSelector('input[type="password"]');
      await waitForInputFocus(page);
      await page.type('input[type="password"]', password);
      await page.keyboard.press("Enter");
    } else {
      console.log("login...");
      let browser = await puppeteerExtra.launch({
        ...BROWSER_OPTIONS,
        headless: false,
      });
      let loginPage = await login(browser, url, account, password, userDataDir, browserOptions, true);
      await loginPage.close();
      await browser.close();
      console.log("login done");
      await loadCookies(page, userDataDir);
      await page.goto(url);
    }
  }
  await page.waitForSelector("#share");
  await saveCookies(page, userDataDir);

  return page;
}

function sleep(ms) {
  return new Promise((rel) => setTimeout(rel, ms));
}

async function waitForInputFocus(page) {
  await loop(async () => {
    let focused = await page.evaluate((_) => {
      return (
        document.activeElement &&
        document.activeElement.tagName &&
        document.activeElement.tagName.toLowerCase() === "input"
      );
    });
    if (focused) return true;
  });
}

async function saveCookies(page, userDataDir) {
  let saveTo = path.join(userDataDir, "cookies.json");
  let cookiesObject = await page.cookies();
  await fs.writeFile(saveTo, JSON.stringify(cookiesObject));
}

async function loadCookies(page, userDataDir) {
  let saveTo = path.join(userDataDir, "cookies.json");
  if (await fs.pathExists(saveTo)) {
    let cookiesObject = JSON.parse((await fs.readFile(saveTo, "UTF-8")) || "[]");
    for (let cookie of cookiesObject) {
      await page.setCookie(cookie);
    }
  }
}

async function loop(fn, ms = 33) {
  while (true) {
    let val = await fn();
    if (val !== undefined) return val;
    await sleep(ms);
  }
}
