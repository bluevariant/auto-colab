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
const cheerio = require("cheerio");
const { v4 } = require("uuid");

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
    console.log("state:", params.state, params.uuid);

    let session = params.uuid;
    let controller = {
      canceled: false,
      run(fn, thisArg = null, ...params) {
        if (session !== global.uuid) return;
        return fn.call(thisArg, ...params);
      },
    };
    try {
      myWorker(params.state, controller.run).then(() => cb(null));
    } catch (e) {
      console.error(e);
      cb(null);
    }
    return { cancel: () => (controller.canceled = true) };
  },
  { id: "id", cancelIfRunning: true }
);

(async () => {
  global.browserOptions = BROWSER_OPTIONS;
  let accounts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "accounts.json"), "UTF-8") || "[]");
  global.accounts = accounts;
  let userDataDir = path.join(DATA_DIR, "users", slug(accounts[0].login));
  fs.ensureDirSync(userDataDir);
  global.userDataDir = userDataDir;

  await puppeteer.registerCustomQueryHandler("shadow", QueryHandler);
  let browser = await puppeteer.launch(browserOptions);
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
      } else if (state === "busy") {
        state = "connected";
      } else if (state === "reconnect") {
        state = "connect";
      }
      // if (!["reconnect", "connect", "allocating", "connecting", "initializing", "connected", "busy"].includes(state)) {
      //   state = undefined;
      // }
      if (!["connected", "connect"].includes(state)) {
        state = "switch";
      }
    } catch (e) {}
    if (state) {
      if (lastState !== state) {
        if (state === "connect") global.uuid = v4();
        if (state !== "switch") worker.push({ id: 1, state, uuid: global.uuid + "" });
        lastState = state;
      }
    }
  });
})();

global.mountDrive = async function (url, run) {
  let browser = await puppeteerExtra.launch({ headless: true });
  let loginPage;
  try {
    loginPage = await login(
      browser,
      url,
      accounts[0].login,
      accounts[0].password,
      userDataDir,
      browserOptions,
      true,
      "#submit_approve_access"
    );
    await run(sleep, 1000);
    await run(loginPage.focus, loginPage, "#submit_approve_access");
    await run(loginPage.click, loginPage, "#submit_approve_access");
    await run(loginPage.waitForSelector, loginPage, "textarea");
    let token = await run(loginPage.$eval, loginPage, "textarea", (elm) => elm.value);
    console.log("token: " + token);
    await run(page.type, page, ".raw_input", token);
    await run(page.keyboard.press, page.keyboard, "Enter");
  } catch (e) {
    console.error(e);
  }
  if (loginPage) await loginPage.close();
  await browser.close();
};

async function login(
  browser,
  url,
  account,
  password,
  userDataDir,
  browserOptions,
  loginAction,
  elementId = "#share",
  ignoreCookie
) {
  const page = (await browser.pages())[0];
  page.setDefaultNavigationTimeout(120000);
  if (!ignoreCookie) await loadCookies(page, userDataDir);
  await page.setUserAgent(USER_AGENT);
  await page.goto(url);
  let needLogin = false;
  await loop(async () => {
    let check = await page.evaluate((account) => {
      let loginElm = document.querySelector("#identifierId");
      let colabElm = document.querySelector("#share");
      let chooseQ = 'div[data-identifier="' + account + '"]';
      let chooseElm = document.querySelector(chooseQ);
      if (loginElm) return "login";
      if (colabElm) return "colab";
      if (chooseElm) return chooseQ;
      return null;
    }, account);
    if (check) {
      needLogin = check;
      return true;
    }
  });
  if (needLogin !== "colab") {
    if (loginAction) {
      if (needLogin === "login") {
        await page.waitForSelector("#identifierId");
        await page.type("#identifierId", account);
        await page.click("#identifierNext");
        await page.waitForSelector('input[type="password"]');
        await waitForInputFocus(page);
        await page.type('input[type="password"]', password);
        await page.keyboard.press("Enter");
      } else {
        await page.click(needLogin);
      }
    } else {
      console.log("login...");
      let browser = await puppeteerExtra.launch({ headless: true });
      let loginPage = await login(browser, url, account, password, userDataDir, browserOptions, true);
      await loginPage.close();
      await browser.close();
      console.log("login done");
      await loadCookies(page, userDataDir);
      await page.goto(url);
    }
  }
  await page.waitForSelector(elementId);
  await saveCookies(page, userDataDir);

  return page;
}

global.sleep = function sleep(ms) {
  return new Promise((rel) => setTimeout(rel, ms));
};

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

global.loadCookies = async function loadCookies(page, userDataDir) {
  let saveTo = path.join(userDataDir, "cookies.json");
  if (await fs.pathExists(saveTo)) {
    let cookiesObject = JSON.parse((await fs.readFile(saveTo, "UTF-8")) || "[]");
    for (let cookie of cookiesObject) {
      await page.setCookie(cookie);
    }
  }
};

global.loop = async function loop(fn, ms = 33) {
  while (true) {
    let val = await fn();
    if (val !== undefined) return val;
    await sleep(ms);
  }
};

global.runFocusedCell = async function () {
  await page.keyboard.down("Control");
  await sleep(100);
  await page.keyboard.press("Enter");
  await sleep(100);
  await page.keyboard.up("Control");
};

global.deleteFocusedCell = async function () {
  await page.keyboard.down("Control");
  await sleep(100);
  await page.keyboard.press("m");
  await sleep(100);
  await page.keyboard.up("Control");
  await sleep(100);
  await page.keyboard.press("d");
};

global.waitFocusedCellOutput = async function () {
  // cell code icon-scrolling focused code-has-output
  await page.waitForSelector("shadow/.cell.code.focused.code-has-output");
  return await page.$eval("shadow/.cell.code.focused.code-has-output pre", (elm) => elm.innerText.trim());
};

global.getMachineId = async function () {
  await page.click("#toolbar-add-code");
  await page.keyboard.type("!cat /sys/class/dmi/id/board_serial");
  await runFocusedCell();
  let output = await waitFocusedCellOutput();
  await deleteFocusedCell();
  return output;
};

global.getCells = async function () {
  return (
    await page.$$eval("shadow/.cell.code", (elements) =>
      elements.map((elm) => {
        let rect = elm.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          centerX: (rect.x + rect.right) / 2,
          centerY: (rect.y + rect.bottom) / 2,
          text: elm.innerText,
          html: elm.innerHTML,
          id: elm.getAttribute("id"),
          classes: elm.getAttribute("class"),
        };
      })
    )
  ).map((cell) => {
    if (cell.html) {
      let $ = cheerio.load("<div>" + cell.html + "</div>");
      let output = ($("pre").text() || "").trim();
      if (output && output.length) {
        cell.output = output.trim();
      }
      if (
        cell.html.includes(
          'Go to this URL in a browser: <a rel="nofollow" target="_blank" href="https://accounts.google.com'
        )
      ) {
        cell.driveUrl = $('a[rel="nofollow"]').attr("href");
      }
      cell.lines = [];
      $(".view-line").each((i, e) => {
        cell.lines.push($(e).text());
      });
    }
    delete cell.html;
    cell.running = cell.classes.includes("running");
    cell.pending = cell.classes.includes("pending");
    cell.focus = () => page.focus("shadow/#" + cell.id);
    return cell;
  });
};

global.waitForCellFree = async function (id) {
  await loop(async () => {
    let classes = await page.$eval("shadow/#" + id, (elm) => elm.getAttribute("class"));
    if (!classes.includes("pending") && !classes.includes("running")) {
      return true;
    }
  });
};

global.waitRunningCell = async function (run, output) {
  await loop(async () => {
    let cells = await run(getCells);
    if (!cells) return false;
    for (let cell of cells) {
      if (cell.running) {
        // return true;
        if (output && cell.output) {
          return true;
        } else if (!output) return true;
      }
    }
  });
};

global.IamStillAlive = async function () {
  await page.click("#toolbar-add-code");
  await page.keyboard.type(`!cat echo "i'm still alive"`);
  await runFocusedCell();
  let output = await waitFocusedCellOutput();
  await deleteFocusedCell();
  return output;
};
