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
        ed = m.mountEditor(el, session, mu, {
          lint: mu.settings.get("lint", { sid: session.sid }) !== false,
          mode: String(mu.settings.get("mode", { sid: session.sid }) ?? "auto")
        });
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
