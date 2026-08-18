/**
 * JobsPanel — live background-job panel (/jobs): id/kind/status rows,
 * arrow navigation, space toggles the selected job's log tail, k kills.
 *
 * @module dsh-tui-app/components/jobs-panel
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

function statusColor(status) {
  if (status === "running") return "accent";
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  return "warning"; // killed / other
}

function fmtAge(ms) {
  if (!ms) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

export default function JobsPanel({ menu }) {
  if (!menu) return null;
  const selected = menu.selected ?? 0;
  const jobs = menu.jobs ?? [];
  const log = menu.logText ?? "";
  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: "#4D6BFE",
      paddingX: 1,
      marginBottom: 0,
    },
    h(Text, { bold: true, color: "#4D6BFE" }, ` jobs ${jobs.length ? `(${jobs.length})` : ""} `),
    jobs.length === 0
      ? h(Text, { dimColor: true }, "  无后台任务")
      : jobs.map((job, i) => {
          const isSel = i === selected;
          const mark = job.status === "running" ? "▶" : "■";
          return h(
            Text,
            { key: job.id, bold: isSel, color: isSel ? "#4D6BFE" : undefined },
            `  ${isSel ? paint("● ", "accent") : "  "}${paint(mark, statusColor(job.status))} ${job.id}  ${job.kind ?? ""}  ${paint(job.status ?? "", statusColor(job.status))}${job.ageMs ? paint(`  ${fmtAge(job.ageMs)}`, "dim") : ""}`
          );
        }),
    log !== ""
      ? h(
          Box,
          { flexDirection: "column", borderStyle: "single", borderColor: "#4D6BFE", marginLeft: 2, marginTop: 0, paddingX: 1 },
          h(Text, { wrap: "wrap" }, log.slice(0, 2000))
        )
      : null,
    h(Text, { dimColor: true }, "  ↑↓ 选择 · 空格 日志 · k 停止 · esc 关闭")
  );
}
