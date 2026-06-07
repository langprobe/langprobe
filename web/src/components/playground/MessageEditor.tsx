"use client";

import type { Message } from "@/components/PlaygroundClient";

interface MessageEditorProps {
  message: Message;
  onChange: (next: Message) => void;
  onDelete: () => void;
  /** Undefined when this is the first message. */
  onMoveUp?: () => void;
  /** Undefined when this is the last message. */
  onMoveDown?: () => void;
  /** Disables delete when there's only one message left. */
  canDelete: boolean;
}

const ROLE_LABEL: Record<Message["role"], string> = {
  system: "SYSTEM",
  human: "HUMAN",
};

export function MessageEditor({
  message,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  canDelete,
}: MessageEditorProps) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--r-3)",
        overflow: "hidden",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "var(--surface-2)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 0.6,
              color: "var(--text-3)",
              minWidth: 56,
            }}
          >
            {ROLE_LABEL[message.role]}
          </span>
          <select
            aria-label="message role"
            value={message.role}
            onChange={(e) =>
              onChange({
                ...message,
                role: e.target.value as Message["role"],
              })
            }
            style={{
              fontSize: 12,
              border: "1px solid var(--border)",
              borderRadius: "var(--r-1)",
              background: "var(--surface)",
              color: "var(--text-2)",
              padding: "2px 6px",
              cursor: "pointer",
            }}
          >
            <option value="system">System</option>
            <option value="human">Human</option>
          </select>
        </label>
        <div style={{ display: "flex", gap: 2 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onMoveUp}
            disabled={!onMoveUp}
            aria-label="move message up"
            style={{ minWidth: 28, padding: "0 8px" }}
          >
            &uarr;
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onMoveDown}
            disabled={!onMoveDown}
            aria-label="move message down"
            style={{ minWidth: 28, padding: "0 8px" }}
          >
            &darr;
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onDelete}
            disabled={!canDelete}
            aria-label="delete message"
            style={{ minWidth: 28, padding: "0 8px" }}
          >
            &times;
          </button>
        </div>
      </div>
      <textarea
        value={message.content}
        onChange={(e) => onChange({ ...message, content: e.target.value })}
        placeholder={
          message.role === "system"
            ? "You are a helpful assistant..."
            : "Write the user turn. Use {{ var }} for variables."
        }
        rows={Math.max(2, Math.min(12, message.content.split("\n").length + 1))}
        style={{
          width: "100%",
          padding: 12,
          border: 0,
          resize: "vertical",
          fontSize: 13,
          fontFamily: "inherit",
          background: "var(--surface)",
          color: "var(--text)",
          boxSizing: "border-box",
          outline: "none",
        }}
      />
    </div>
  );
}
