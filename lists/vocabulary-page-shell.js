"use strict";

const LIST_PAGES = [
  { id: "frequency", label: "词频", href: "lists/frequency/" },
  { id: "hsk", label: "HSK", href: "lists/hsk/" },
  { id: "zimu", label: "字幕", href: "lists/zimu/" },
  { id: "boya", label: "博雅", href: "lists/boya/" },
  { id: "saved", label: "收藏", href: "lists/saved/" }
];
const PAGE_VIEWS = {
  frequency: [{ id: "list", label: "清单" }, { id: "progress", label: "进度" }],
  hsk: [
    { id: "list", label: "清单" },
    { id: "progress", label: "进度" },
    { id: "music", label: "音乐" }
  ],
  zimu: [{ id: "list", label: "清单" }, { id: "progress", label: "进度" }]
};

function createShellLink(label, href, isCurrent) {
  const link = document.createElement("a");
  link.href = href;
  if (isCurrent) link.setAttribute("aria-current", "page");
  link.append("[ ");
  const navLabel = document.createElement("span");
  navLabel.className = "nav-label";
  navLabel.textContent = label;
  link.append(navLabel, " ]");
  return link;
}

function mountVocabularyPageShell() {
  const page = document.body.dataset.page;
  const rootHref = document.body.dataset.rootHref;
  const headerMount = document.querySelector("#vocabulary-page-header");
  const accountMount = document.querySelector("#vocabulary-page-account");
  if (!page || !rootHref || !headerMount || !accountMount) {
    throw new Error("Vocabulary page shell is missing its page, root URL, or mount points.");
  }

  const header = document.createElement("header");
  header.className = "dict-header";
  const title = document.createElement("h1");
  title.className = "dict-title";
  const homeLink = document.createElement("a");
  homeLink.className = "title-main";
  homeLink.href = `${rootHref}index.html`;
  homeLink.textContent = "词典";
  title.append(homeLink);
  header.append(title);

  const views = PAGE_VIEWS[page] ?? [];
  const listNavigation = document.createElement("nav");
  listNavigation.className = "site-nav";
  listNavigation.setAttribute("aria-label", "Vocabulary lists");
  for (const listPage of LIST_PAGES) {
    listNavigation.append(createShellLink(
      listPage.label,
      `${rootHref}${listPage.href}`,
      listPage.id === page
    ));
  }

  if (views.length) {
    const stack = document.createElement("div");
    stack.className = "site-nav-stack";
    stack.append(listNavigation);
    const viewNavigation = document.createElement("nav");
    viewNavigation.className = "list-view-nav";
    viewNavigation.setAttribute("aria-label", `${page} views`);
    const activeView = window.location.hash.slice(1) || "list";
    for (const view of views) {
      viewNavigation.append(createShellLink(
        view.label,
        `#${view.id}`,
        view.id === activeView
      ));
    }
    stack.append(viewNavigation);
    header.append(stack);
  } else {
    header.append(listNavigation);
  }
  headerMount.replaceWith(header);

  const accountActions = document.createElement("div");
  accountActions.className = "account-actions";
  const exportButton = document.createElement("button");
  exportButton.id = "download-known-words";
  exportButton.className = "known-words-export";
  exportButton.type = "button";
  exportButton.textContent = "认识词CSV";
  exportButton.setAttribute("aria-label", "Download all known words as a CSV");
  exportButton.title = "Download all known words as a CSV";
  exportButton.disabled = true;
  const exportStatus = document.createElement("span");
  exportStatus.id = "known-words-export-status";
  exportStatus.className = "known-words-export-status";
  exportStatus.setAttribute("role", "status");
  exportStatus.setAttribute("aria-live", "polite");
  exportStatus.hidden = true;

  const accountLink = document.createElement("a");
  accountLink.id = "hsk-account-link";
  accountLink.className = "account-link";
  accountLink.href = `${rootHref}login/`;
  accountLink.setAttribute("aria-label", "登录");
  accountLink.title = "登录";
  const connection = document.createElement("span");
  connection.id = "account-connection";
  connection.textContent = "登录";
  const avatar = document.createElement("img");
  avatar.id = "account-avatar";
  avatar.className = "account-avatar";
  avatar.alt = "";
  avatar.hidden = true;
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const head = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  head.setAttribute("cx", "12");
  head.setAttribute("cy", "8");
  head.setAttribute("r", "3.5");
  const shoulders = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shoulders.setAttribute("d", "M4.8 20c.7-3.5 3.4-5.3 7.2-5.3s6.5 1.8 7.2 5.3");
  icon.append(head, shoulders);
  accountLink.append(connection, avatar, icon);
  accountActions.append(exportButton, accountLink, exportStatus);
  accountMount.replaceWith(accountActions);
}

mountVocabularyPageShell();
