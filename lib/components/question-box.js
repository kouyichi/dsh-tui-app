/**
 * QuestionBox — ask_user_question overlay (also renders plan-review intents,
 * i.e. the P4 plan approval flow). Number/typed answers submit on Enter.
 *
 * @module dsh-tui-app/components/question-box
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

export default function QuestionBox({ question }) {
  if (!question) return null;
  const { item, index, total } = question;
  const opts = item.options ?? [];
  const isPlan = item.intent?.kind === "plan-review";
  const head = isPlan ? paint("计划审批", "accent-bold") : paint(`问题 ${index + 1}/${total}`, "accent-bold");
  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: "#4D6BFE",
      paddingX: 1,
      marginBottom: 0,
    },
    h(Text, { bold: true, color: "#4D6BFE" }, ` ${head} `),
    item.header ? h(Text, { bold: true }, `  ${item.header}`) : null,
    h(Text, { wrap: "wrap" }, `  ${item.question}`),
    item.detail
      ? h(Text, { wrap: "wrap", dimColor: true }, `  ${item.detail.slice(0, 600)}${item.detail.length > 600 ? "…" : ""}`)
      : null,
    opts.length > 0
      ? h(
          Text,
          { wrap: "wrap" },
          `  ${opts.map((o, i) => `[${i + 1}] ${o.label}`).join("  ")}`
        )
      : null,
    h(
      Text,
      { dimColor: true },
      opts.length > 0
        ? "  输入编号（多选用 1,3）或自定义文本后回车 · esc 取消"
        : "  输入回答后回车 · esc 取消"
    )
  );
}
