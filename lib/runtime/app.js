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

import React, { useEffect } from "react";
import { Box, useApp } from "ink";
import { h } from "./jsx.js";
import { useStore } from "./store.js";
import Splash from "../components/splash.js";
import MessageStream from "../components/message-stream.js";
import StatusBar from "../components/status-bar.js";
import InputBox from "../components/input-box.js";

/**
 * Root component.
 * @param store - runtime store ({events, meta, input, status, fold})
 * @param ctl - controllers ({ exit, cycleFold, ... })
 */
export default function App({ store, ctl }) {
  const { exit } = useApp();
  const events = useStore(store, (s) => s.events);
  const meta = useStore(store, (s) => s.meta);
  const input = useStore(store, (s) => s.input);
  const status = useStore(store, (s) => s.status);
  const fold = useStore(store, (s) => s.fold);

  // Escalate controller exit to Ink exit.
  useEffect(() => {
    ctl.onExitRequest = () => exit();
    return () => {
      ctl.onExitRequest = null;
    };
  }, [ctl, exit]);

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
