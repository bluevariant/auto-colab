#!/usr/bin/env node

console.error = function (e) {
  if (e && e.message) console.log(e.message);
};

const { addExtra } = require("puppeteer-extra");
const originPuppeteer = require("puppeteer");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { QueryHandler } = require("query-selector-shadow-dom/plugins/puppeteer");
const path = require("path");
const slug = require("slug");
const fs = require("fs-extra");
const cheerio = require("cheerio");
const _ = require("lodash");
const prompts = require("prompts");
const moment = require("moment");

async function main(initial = 4) {
  let dataDir = path.join(__dirname, "data");
  await fs.ensureDir(dataDir);
  let dataFile = path.join(dataDir, "data.json");
  let data = {
    accounts: [],
    books: [],
  };
  if (await fs.pathExists(dataFile)) {
    data = JSON.parse(await fs.readFile(dataFile, "UTF-8"));
  }
  const updateData = async () => {
    await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
  };
  let action = await prompts({
    type: "select",
    name: "value",
    message: "Actions?",
    choices: [
      { title: "New account", value: "new-account" },
      { title: "Delete account", value: "del-account", disabled: data.accounts.length === 0 },
      { title: "New notebook", value: "new-notebook" },
      { title: "Delete notebook", value: "del-notebook", disabled: data.books.length === 0 },
      { title: "Run", value: "run", disabled: data.accounts.length === 0 || data.books.length === 0 },
    ],
    initial,
  });
  if (action.value === "new-account") {
    action = await prompts([
      {
        type: "text",
        name: "email",
        message: "Email?",
      },
      {
        type: "password",
        name: "password",
        message: "Password?",
      },
    ]);
    if (action.email && action.password) {
      data.accounts.push(action);
      await updateData();
    }
    await main(0);
  }
  if (action.value === "del-account") {
    action = await prompts({
      type: "select",
      name: "email",
      message: "Delete accounts?",
      choices: data.accounts.map((v) => ({
        title: v.email,
        value: v.email,
      })),
      initial: 0,
    });
    if (action.email) {
      let index = _.findIndex(data.accounts, (v) => v.email === action.email);
      data.accounts.splice(index, 1);
      await updateData();
    }
    await main(1);
  }
  if (action.value === "new-notebook") {
    action = await prompts([
      {
        type: "text",
        name: "name",
        message: "Name?",
      },
      {
        type: "text",
        name: "url",
        message: "Url?",
      },
    ]);
    if (action.name && action.url) {
      data.books.push(action);
      await updateData();
    }
    await main(2);
  }
  if (action.value === "del-notebook") {
    action = await prompts({
      type: "select",
      name: "url",
      message: "Delete notebooks?",
      choices: data.books.map((v) => ({
        title: v.name + " " + v.url,
        value: v.url,
      })),
      initial: 0,
    });
    if (action.url) {
      let index = _.findIndex(data.books, (v) => v.url === action.url);
      data.books.splice(index, 1);
      await updateData();
    }
    await main(3);
  }
  if (action.value === "run") {
    action = await prompts([
      {
        type: "select",
        name: "account",
        message: "Account?",
        choices: data.accounts.map((v) => ({
          title: v.email,
          value: v,
        })),
        initial: 0,
      },
      {
        type: "select",
        name: "notebook",
        message: "Notebook?",
        choices: data.books.map((v) => ({
          title: v.name + " " + v.url,
          value: v.url,
        })),
        initial: 0,
      },
      {
        type: "select",
        name: "headless",
        message: "Headless?",
        choices: [
          { title: "True", value: true },
          { title: "False", value: false },
        ],
        initial: 1,
      },
    ]);
    await start(action.account.email, action.account.password, action.notebook, action.headless);
  }
}

main().catch(console.error);

async function start(user, password, url, headless = false) {
  await originPuppeteer.registerCustomQueryHandler("shadow", QueryHandler);
  const puppeteer = addExtra(originPuppeteer);
  puppeteer.use(StealthPlugin());
  //////
  const config = {};
  // config.url = "https://colab.research.google.com/drive/10oSUbDkLeMbH04bi2pJwMuIaxWJ8jE2m";
  config.url = url;
  config.login = user;
  config.password = password;
  config.dataDir = path.join(__dirname, "data", slug(config.login));
  await fs.ensureDir(config.dataDir);
  config.defaultBrowserConfig = {
    headless,
    args: [
      "--start-maximized",
      "--disable-features=site-per-process",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-infobars",
      "--single-process",
      "--no-zygote",
      "--disable-setuid-sandbox",
    ],
    defaultViewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
  };
  config.driveToken = null;
  config.maxPages = 1;
  config.connected = false;
  //////
  console.log("---");
  console.log(path.join(config.dataDir, slug(url)) + ".output.html");
  console.log("---");
  //////
  const browser = await puppeteer.launch(config.defaultBrowserConfig);
  browser.on("targetcreated", async (target) => {
    const page = await target.page();
    if (page) {
      let pages = await browser.pages();
      if (pages.length > config.maxPages) {
        page.close().catch(console.log);
      }
    }
  });
  const page = (await browser.pages())[0];
  await initPage(page);
  await page.goto(config.url);
  await page.waitForSelector("#share");
  let rID;
  let rIDFile = path.join(config.dataDir, "runTimeId");
  page.on("response", async (res) => {
    if (res.url().includes("api/sessions?authuser")) {
      let data = await res.json();
      if (data && data.kernel) {
        rID = data.kernel.id;
      }
    }
  });
  let lastState;
  await loop(async () => {
    await page.waitForSelector("shadow/#connect");
    let state = await page.$eval("shadow/#connect", (elm) => elm.innerText);
    state = slug(state);
    if (!state) {
      try {
        let title = await page.$eval("shadow/#connect-icon", (elm) => elm.getAttribute("title"));
        if (title.length > 0) {
          state = "connected";
        }
      } catch (e) {}
    }
    if (state === "ram-disk") {
      state = "connected";
    } else if (state === "busy") {
      state = "connected";
    }
    if (lastState !== state) {
      if (state === "connected") {
        await cleanRunOnceCells();
        let lastRID;
        if (await fs.pathExists(rIDFile)) {
          lastRID = await fs.readFile(rIDFile, "UTF-8");
        }
        // if (lastRID !== rID) {
        //   processNew(rID + "").catch(console.error);
        // } else {
        //   processOld(rID + "").catch(console.error);
        // }
        parseOutputs(rID + "").catch(console.error);
        driveConnector(rID + "").then((isNew) => {
          if (isNew) processNew(rID + "").catch(console.error);
          else processOld(rID + "").catch(console.error);
        });
        await fs.writeFile(rIDFile, rID);
      } else if (state === "connect" || state === "reconnect") {
        await page.click("shadow/#connect");
        await cleanRunOnceCells();
      }
      lastState = state;
    }
  });

  //////
  async function parseOutputs(cRID) {
    await loop(async () => {
      if (cRID !== rID) return true;
      let outputs = [];
      let cells = await getCells();
      for (let cell of cells) {
        outputs.push('<div class="autocolab-section">');
        outputs.push(
          '<pre class="autocolab-code ' +
            cell.classes +
            '">' +
            cell.lines.map((v) => v.replace("#autocolab:section", "# autocolab:section")).join("\r\n") +
            "</pre>"
        );
        await wathCellOutput(cRID, cell.id, async (output) => {
          if (output) outputs.push('<pre class="autocolab-output">' + output + "</pre>");
          return true;
        });
        outputs.push("</div>");
      }
      let template = await fs.readFile(path.join(__dirname, "output-template.html"), "UTF-8");
      template = template.replace("#[[$TITLE$]]#", url);
      template = template.replace("#[[$IMG$]]#", await page.screenshot({ encoding: "base64" }));
      outputs.unshift(`<div>URL: <a href="${url}" target="_blank">${url}</a></div>`);
      outputs.unshift(`<div>Last updated at: ${moment().format("DD/MM/YYYY HH:mm:ss")}</div>`);
      template = template.replace("#[[$BODY$]]#", outputs.join("\r\n"));
      await fs.writeFile(path.join(config.dataDir, slug(url)) + ".output.html", template);
      ///
      if (config.connected) {
        try {
          // Click refresh drive.
          await page.$eval('shadow/paper-item[page="files"]', (element) => {
            console.log(element.getAttribute("aria-selected"));
            if (element && element.getAttribute("aria-selected") + "" === "false") {
              element.click();
            }
          });
          await page.$eval('shadow/paper-icon-button[icon="colab:folder-refresh"]', (element) => {
            if (!element) return;
            element.click();
            console.log("click");
          });
        } catch (ignoredError) {}
      }
    }, 10000);
  }

  async function processNew(cRID) {
    await cleanRunOnceCells();
    console.log("connected new:", cRID);
    await page.keyboard.down("Control");
    await page.keyboard.press("F9");
    await page.keyboard.up("Control");
  }

  async function processOld(cRID) {
    await cleanRunOnceCells();
    console.log("connected old:", cRID);
    let sectionCell;
    let cells = await getCells();
    for (let cell of cells) {
      if (cell.lines[0].includes("autocolab:section")) {
        sectionCell = cell;
        break;
      }
    }
    if (sectionCell) {
      await sectionCell.focus();
      await page.keyboard.down("Control");
      await page.keyboard.press("F10");
      await page.keyboard.up("Control");
    } else {
      await exec(cRID, "# autocolab:section", async () => true, false);
    }
  }

  async function driveConnector(cRID) {
    let isNew = false;
    config.driveToken = null;
    config.connected = false;
    await exec(cRID, "from google.colab import drive\ndrive.mount('/content/drive')", async (output) => {
      if (output.length === 0) return false;
      if (output.includes('<input class="raw_input">')) {
        let $ = cheerio.load("<div>" + output + "</div>");
        let href = $("a").attr("href");
        config.maxPages = 2;
        let page1 = await browser.newPage();
        await initPage(page1);
        await page1.goto(href);
        config.maxPages = 1;
        await loop(async () => {
          if (cRID !== rID) return true;
          if (config.driveToken) {
            return true;
          }
        });
        page1.close().catch(console.log);
      }
      ///
      if (typeof config.driveToken === "string") {
        await page.bringToFront();
        console.log("token:", config.driveToken);
        await page.waitForSelector(".raw_input");
        await page.type(".raw_input", config.driveToken);
        await page.keyboard.press("Enter");
        isNew = true;
      }
      ///
      config.connected = true;
      return true;
    });
    return isNew;
  }

  async function cleanRunOnceCells() {
    let cells = await getCells();
    for (let cell of cells) {
      if (cell.lines && cell.lines.length > 0 && cell.lines.filter((v) => v.includes("autocolab:runonce")).length > 0) {
        await deleteCellById(cell.id);
      }
    }
  }

  async function exec(cRID, code, cb, deleteCell = true) {
    if (deleteCell) code = "# autocolab:runonce\n" + code;
    await page.click("#toolbar-add-code");
    await page.keyboard.type(code);
    await runFocusedCell();
    let cell = await getFocusedCell();
    if (cell) {
      await wathCellOutput(cRID, cell.id, cb);
      if (deleteCell) await deleteCellById(cell.id);
    }
  }

  async function wathCellOutput(cRID, cellId, cb) {
    let lastOutput = Number.MIN_VALUE;
    await loop(async () => {
      if (cRID !== rID) return true;
      let ids = ["shadow/#" + cellId + " pre", "#output-area"];
      let output;
      for (let id of ids) {
        let queryFrame = page;
        let iframeOutput = await page.$eval("shadow/#" + cellId, (elm) => {
          return !!elm.querySelector("iframe");
        });
        if (iframeOutput) {
          let elementHandle = await page.$("shadow/#" + cellId + " iframe");
          if (elementHandle) {
            let frame = await elementHandle.contentFrame();
            if (frame) queryFrame = frame;
          }
        }
        try {
          output = await queryFrame.$eval(id, (elm) => elm.innerHTML);
          if (output) break;
        } catch (e) {}
        if (output) break;
      }
      if (lastOutput !== output) {
        if ((await cb((output || "").trim())) === true) return true;
        lastOutput = output;
      }
    });
  }

  async function deleteCellById(cellId) {
    let cells = await getCells();
    for (let cell of cells) {
      if (cell.id === cellId) {
        await cell.focus();
        await page.click("shadow/#" + cellId + ' paper-icon-button[icon="icons:delete"]');
        return;
      }
    }
  }

  async function focusCell(cellId) {
    await page.focus("shadow/#" + cellId);
    let rect = await page.$eval("shadow/#" + cellId, (element) => {
      let rect = element.getBoundingClientRect();
      return { x: (rect.x + rect.right) / 2, y: (rect.y + rect.bottom) / 2 };
    });
    await page.mouse.click(rect.x, rect.y);
  }

  async function getFocusedCell() {
    let cells = await getCells();
    for (let cell of cells) {
      if (cell.classes.includes("focused")) return cell;
    }
  }

  async function runFocusedCell() {
    await page.click("shadow/.cell-execution.focused");
  }

  async function waitForCellFree(cRID, cellId) {
    await loop(async () => {
      if (cRID !== rID) return true;
      let classes = await page.$eval("shadow/#" + cellId, (elm) => elm.getAttribute("class"));
      if (classes === undefined) return true;
      if (!classes.includes("pending") && !classes.includes("running")) {
        return true;
      }
    });
  }

  async function getCells() {
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
        cell.lines = cell.lines.map((v) => v.replace(/ /g, " "));
      }
      delete cell.html;
      cell.running = cell.classes.includes("running");
      cell.pending = cell.classes.includes("pending");
      cell.focus = () => focusCell(cell.id);
      return cell;
    });
  }

  async function initPage(page) {
    let defaultTimeout = 1000 * 60 * 60 * 24 * 7;
    page.setDefaultNavigationTimeout(defaultTimeout);
    page.setDefaultTimeout(defaultTimeout);
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15"
    );
    await loadCookies(page, config.dataDir);
    const processUrl = _.debounce(async () => {
      let currentUrl = await page.url();
      if (currentUrl.includes("/ServiceLogin/signinchooser")) {
        await page.click('div[data-identifier="' + config.login + '"]');
        if ((await waitForSelectors(page, 'input[type="password"]', "#share")) !== "#share") {
          await autoFillPassword(page);
        }
      } else if (currentUrl.includes("/signin/v")) {
        await autoFillAccount(page);
        await page.waitForSelector("#share");
        await saveCookies(page, config.dataDir);
      } else if (currentUrl.includes("accounts.google.com/o/oauth2")) {
        let loginType = undefined;
        await loop(async () => {
          loginType = await page.evaluate((account) => {
            let loginElm = document.querySelector("#identifierId");
            let chooseQ = 'div[data-identifier="' + account + '"]';
            let chooseElm = document.querySelector(chooseQ);
            if (loginElm) return "login";
            if (chooseElm) return chooseQ;
            return null;
          }, config.login);
          if (loginType) return true;
        });
        if (loginType === "login") await autoFillAccount(page);
        else {
          await page.click(loginType);
          if (
            (await waitForSelectors(page, 'input[type="password"]', "#submit_approve_access")) !==
            "#submit_approve_access"
          ) {
            await autoFillPassword(page);
          }
        }
        await page.waitForSelector("#submit_approve_access");
        await page.$eval("form", (element) => (element.style.display = "none"));
        await page.click("#submit_approve_access");
        await page.waitForSelector("textarea");
        config.driveToken = await page.$eval("textarea", (element) => element.value);
        await saveCookies(page, config.dataDir);
      }
    }, 1000);
    page.on("domcontentloaded", () => {
      page.waitForNavigation().then(processUrl);
    });
  }

  async function waitForSelectors(page, ...selectors) {
    let races = [];
    _.forEach(selectors, (selector) => {
      races.push(
        (async () => {
          await page.waitForSelector(selector);
          return selector;
        })()
      );
    });
    return await Promise.race(races);
  }

  async function autoFillAccount(page) {
    await page.waitForSelector("#identifierId");
    await page.type("#identifierId", config.login);
    await page.click("#identifierNext");
    await autoFillPassword(page);
  }

  async function autoFillPassword(page) {
    await page.waitForSelector('input[type="password"]');
    await waitForInputFocus(page);
    await page.type('input[type="password"]', config.password);
    await page.keyboard.press("Enter");
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

  async function loop(fn, ms = 100) {
    while (true) {
      let val = await fn();
      if (val !== undefined) return val;
      await sleep(ms);
    }
  }

  function sleep(ms) {
    return new Promise((rel) => setTimeout(rel, ms));
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

  //////
}
