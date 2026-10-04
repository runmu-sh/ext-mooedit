// src/index.ts
import { defineExtension } from "@muclient/sdk";

// src/protocol.ts
var one = (v, sep = "\n") => Array.isArray(v) ? v.join(sep) : v ?? "";
var lines = (v) => Array.isArray(v) ? [...v] : one(v).split("\n");
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}
var normal = (text) => text.replace(/\r\n?/g, "\n");
var simpleeditLanguage = (type) => type === "moo-code" ? "moo-code" : "text";
function simpleeditContent(type, text) {
  return type === "string" ? [normal(text).replace(/\n/g, " ")] : normal(text).split("\n");
}
var localEditLanguage = (name, upload) => /:/.test(name) || /^@program\b/i.test(upload) ? "moo-code" : "text";
function uploadText(upload, text) {
  return [upload, ...normal(text).split("\n").map((l) => l.startsWith(".") ? `.${l}` : l), "."].join("\n");
}

// src/index.ts
var SIMPLEEDIT = "dns-org-mud-moo-simpleedit";
var index_default = defineExtension({
  activate({ mu }) {
    mu.settings.define({
      title: "MOO editor",
      items: [
        {
          key: "localEdit",
          label: "Accept LambdaCore local editing (#$# edit)",
          kind: "toggle",
          default: false,
          scope: "world",
          hint: "Opens #$# edit blocks in the editor; Save runs their upload command. Off: they show as text. Off by itself when the game speaks MCP 2.1."
        },
        {
          key: "window",
          label: "Always open the editor in a new window",
          kind: "toggle",
          default: false,
          scope: "global",
          sync: "device",
          hint: "Pops the editor out into its own window instead of a dialog. If the browser blocks the pop-up, it opens as a dialog."
        },
        { key: "lint", label: "Check MOO code as you type", kind: "toggle", default: true },
        {
          key: "mode",
          label: "Text opens in",
          kind: "select",
          default: "auto",
          options: [{ value: "auto", label: "Code for MOO code, prose for text" }, { value: "code", label: "Code mode" }, { value: "prose", label: "Prose mode" }]
        }
      ]
    });
    mu.mcp.on(`${SIMPLEEDIT}-content`, (a, meta) => {
      const reference = one(a.reference);
      if (!reference) return;
      const type = one(a.type) || "string-list";
      mu.editor.open({
        sid: meta.sid,
        id: `simpleedit:${reference}`,
        title: one(a.name, " ") || reference,
        text: lines(a.content).join("\n"),
        language: simpleeditLanguage(type),
        async save(text) {
          const r = await mu.mcp.send(`${SIMPLEEDIT}-set`, { reference, type, content: simpleeditContent(type, text) }, { sid: meta.sid, key: `simpleedit-set:${meta.id}:${hash(text)}` });
          if (r === "not-negotiated") throw new Error("The game is not connected, or no longer speaks simpleedit.");
          if (r === "refused") throw new Error("The game refused the save (too large, or too many sends).");
        }
      });
    });
    mu.mcp.acceptLocalEdit((sid) => mu.settings.get("localEdit", { sid }) === true);
    mu.mcp.on("legacy-edit", (a, meta) => {
      const name = one(a.name, " ") || "text", upload = one(a.upload, " ");
      if (!upload) return;
      mu.editor.open({
        sid: meta.sid,
        id: `local-edit:${upload}`,
        title: `Local edit: ${name}`,
        text: lines(a.content).join("\n"),
        language: localEditLanguage(name, upload),
        command: upload,
        async save(text) {
          const r = await mu.sessions.send(uploadText(upload, text), { sid: meta.sid, raw: true, echo: false, key: `local-edit:${meta.id}:${hash(text)}` });
          if (r === "refused") throw new Error("Not sent: the session is closed.");
        }
      });
    });
    provide(mu);
  }
});
function provide(mu) {
  let mod = null;
  const load = () => mod ??= mu.modules.load("dist/editor.js");
  let failed = false;
  const off = mu.editor.provide({
    id: "mooedit",
    languages: ["moo-code", "text", "markdown"],
    show(session) {
      return failed ? void 0 : showIn(mu, session, load, () => {
        if (failed) return;
        failed = true;
        off();
      });
    }
  });
}
function showIn(mu, session, load, giveUp) {
  if (mu.settings.get("window") === true) {
    const w = showInWindow(mu, session, load, giveUp);
    if (w) return w;
    mu.ui.toast("MOO editor", "The browser blocked the editor window. Allow pop-ups for \u03BCClient to open it in a window; showing it here for now.");
  }
  return showInModal(mu, session, load, giveUp);
}
var editorOpts = (mu, sid) => ({
  lint: mu.settings.get("lint", { sid }) !== false,
  mode: String(mu.settings.get("mode", { sid }) ?? "auto")
});
function mirrorStyles(w) {
  const copies = /* @__PURE__ */ new Map();
  const sync = () => {
    if (w.closed) return;
    const src = document.documentElement, dst = w.document.documentElement;
    for (const a of [...src.attributes]) if ((a.name.startsWith("data-") || a.name === "style" || a.name === "class") && dst.getAttribute(a.name) !== a.value) dst.setAttribute(a.name, a.value);
    const now = new Set(document.head.querySelectorAll('style, link[rel="stylesheet"]'));
    for (const [s, c] of [...copies]) if (!now.has(s)) {
      c.remove();
      copies.delete(s);
    }
    for (const s of now) {
      let c = copies.get(s);
      if (!c) {
        c = w.document.importNode(s, true);
        w.document.head.appendChild(c);
        copies.set(s, c);
      } else if (s.tagName === "STYLE" && c.textContent !== s.textContent) c.textContent = s.textContent;
    }
  };
  const mo = new MutationObserver(sync);
  mo.observe(document.head, { childList: true, subtree: true, characterData: true });
  mo.observe(document.documentElement, { attributes: true });
  sync();
  return () => mo.disconnect();
}
var windows = 0;
function showInWindow(mu, session, load, giveUp) {
  const w = window.open("", `mooedit-${++windows}`, "popup,width=960,height=680");
  if (!w) return null;
  let hostClosed = false, gone = false;
  let ed = null;
  const d = w.document;
  d.open();
  d.write('<!doctype html><html lang="en"><head><meta charset="UTF-8"></head><body></body></html>');
  d.close();
  d.title = session.title;
  d.body.style.margin = "0";
  d.body.style.background = "var(--bg)";
  const stopStyles = mirrorStyles(w);
  const el = d.createElement("div");
  el.className = "mooed-win";
  el.textContent = "Loading the editor\u2026";
  d.body.append(el);
  const teardown = () => {
    if (gone) return;
    gone = true;
    window.removeEventListener("pagehide", closeWin);
    stopStyles();
    ed?.dispose();
    ed = null;
    if (!w.closed) w.close();
  };
  const closeWin = () => {
    hostClosed = true;
    teardown();
  };
  window.addEventListener("pagehide", closeWin);
  w.addEventListener("beforeunload", (e) => {
    if (!hostClosed && ed && !ed.requestClose()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  w.addEventListener("pagehide", () => {
    const cancel = !hostClosed;
    teardown();
    if (cancel) session.cancel();
  });
  w.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (!ed || ed.requestClose()) {
      teardown();
      session.cancel();
    }
  });
  load().then((m) => {
    if (gone) return;
    el.textContent = "";
    ed = m.mountEditor(el, session, mu, editorOpts(mu, session.sid));
    w.focus();
  }, (e) => {
    mu.log.error("the editor module did not load:", e);
    mu.ui.toast("MOO editor", `The code editor could not load (${e?.message ?? e}). Showing the plain editor.`, { kind: "error" });
    hostClosed = true;
    teardown();
    giveUp();
  });
  return closeWin;
}
function showInModal(mu, session, load, giveUp) {
  let hostClosed = false;
  let ed = null;
  const modal = mu.ui.modal({
    title: session.title,
    width: "lg",
    everywhere: true,
    mount(el) {
      let gone = false;
      el.textContent = "Loading the editor\u2026";
      load().then((m) => {
        if (gone) return;
        el.textContent = "";
        ed = m.mountEditor(el, session, mu, editorOpts(mu, session.sid));
      }, (e) => {
        mu.log.error("the editor module did not load:", e);
        mu.ui.toast("MOO editor", `The code editor could not load (${e?.message ?? e}). Showing the plain editor.`, { kind: "error" });
        hostClosed = true;
        modal.close();
        giveUp();
      });
      return () => {
        gone = true;
        ed?.dispose();
        ed = null;
      };
    },
    // Esc, the scrim or ×: unsaved edits ask first, inside the editor (a host dialog would queue behind this modal).
    beforeClose: () => ed ? ed.requestClose() : true
  });
  void modal.closed.then(() => {
    if (!hostClosed) session.cancel();
  });
  return () => {
    hostClosed = true;
    modal.close();
  };
}
export {
  index_default as default
};
