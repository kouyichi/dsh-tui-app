/**
 * JSX-free React helper: h(type, props, ...children).
 * The plugin runs zero-build (pure Node ESM), so components are written with
 * createElement directly. This mirrors Ink's own compiled output.
 *
 * @module dsh-tui-app/runtime/jsx
 */
import React from "react";
export const h = React.createElement;
export default h;
