const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteerExtra.use(StealthPlugin());
const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const path = require("path");
const slug = require("slug");
const { QueryHandler } = require("query-selector-shadow-dom/plugins/puppeteer");

const DATA_DIR = path.join(__dirname, "data");
const BROWSER_OPTIONS = {
  headless: false,
  ignoreDefaultArgs: true,
  args: ["--start-maximized", "--disable-infobars"],
  defaultViewport: null,
};
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15";

// from google.colab import drive
// drive.mount('/content/drive')

(async () => {
  let accounts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "accounts.json"), "UTF-8") || "[]");
  let userDataDir = path.join(DATA_DIR, "users", slug(accounts[0].login));
  fs.ensureDirSync(userDataDir);

  await puppeteer.registerCustomQueryHandler("shadow", QueryHandler);
  let browser = await puppeteer.launch(BROWSER_OPTIONS);
  let page = await login(browser, accounts[0].login, accounts[0].password, userDataDir, BROWSER_OPTIONS);
  await page.click("shadow/#connect");
  console.log("done");
})();

async function login(browser, account, password, userDataDir, browserOptions, loginAction) {
  const page = (await browser.pages())[0];
  await loadCookies(page, userDataDir);
  await page.setUserAgent(USER_AGENT);
  let url = "https://colab.research.google.com/drive/10oSUbDkLeMbH04bi2pJwMuIaxWJ8jE2m";
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
      let loginPage = await login(browser, account, password, userDataDir, browserOptions, true);
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

async function loop(fn) {
  while (true) {
    let val = await fn();
    if (val !== undefined) return val;
    await sleep(33);
  }
}
