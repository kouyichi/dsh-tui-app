/**
 * dsh-tui App — the Ink component tree. Pure presentation: all state comes
 * from the store, all effects go through the controllers passed as props.
 *
 * Layout (fixed, terminal-shaped):
 *   splash (whale banner) ─────────────────────
 *   message stream (flexGrow, scrolls) ────────
 *   status bar ────────────────────────────────
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
import InputBox from "../components/input-box.js";

/**
 * Root component — pure function over the store: every store change is
 * pushed through an Ink `rerender()` by the runner, so no effects or
 * subscriptions are needed here (passive effects don't run reliably
 * under this Ink/React combo).
 */
export default function App({ store, ctl }) {
  const { events, meta, input, status, fold } = store.get();

  return h(
    Box,
    { flexDirection: "column", height: "100%" },
    h(
      Box,
      { flexGrow: 1, flexDirection: "column", overflowY: "auto", minHeight: 1 },
      h(Splash, { meta }),
      h(MessageStream, { events, fold, ctl })
    ),
    h(StatusBar, { status, meta }),
    h(InputBox, { input, ctl })
  );
}
