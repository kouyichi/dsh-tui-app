/**
 * dsh-tui App — the Ink component tree. Pure function over the store: every
 * store change is pushed through an Ink `rerender()` by the runner, so no
 * effects or subscriptions are needed here (passive effects don't run
 * reliably under this Ink/React combo).
 *
 * Layout (fixed, terminal-shaped):
 *   splash (whale banner) ─────────────────────
 *   message stream (flexGrow, scrolls) ────────
 *   status bar (stats, /config-filtered) ──────
 *   config menu (when /config open) ───────────
 *   input line  ❯ ...
 *
 * @module dsh-tui-app/runtime/app
 */

import React from "react";
import { Box } from "ink";
import { h } from "./jsx.js";
import Splash from "../components/splash.js";
import MessageStream from "../components/message-stream.js";
import StatusBar from "../components/status-bar.js";
import ConfigMenu from "../components/config-menu.js";
import InputBox from "../components/input-box.js";

export default function App({ store, ctl }) {
  const { events, meta, input, status, stats, config, configMenu, fold } = store.get();

  return h(
    Box,
    { flexDirection: "column", height: "100%" },
    h(
      Box,
      { flexGrow: 1, flexDirection: "column", overflowY: "auto", minHeight: 1 },
      h(Splash, { meta }),
      h(MessageStream, { events, fold, ctl })
    ),
    h(StatusBar, { status, meta, stats, config }),
    h(ConfigMenu, { config, menu: configMenu }),
    h(InputBox, { input, ctl })
  );
}
