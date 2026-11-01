import React from "react";
import { CodeBlock } from "./CodeBlock";

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  // 1. Separate fenced code blocks from prose
  const parts: Array<{ type: "code"; code: string; language: string } | { type: "text"; text: string }> = [];

  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        text: content.slice(lastIndex, match.index),
      });
    }
    parts.push({
      type: "code",
      language: match[1] || "plaintext",
      code: match[2].trimEnd(),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({
      type: "text",
      text: content.slice(lastIndex),
    });
  }

  return (
    <div className="space-y-1 text-sm text-[#e9edef] leading-relaxed break-words">
      {parts.map((part, pIdx) => {
        if (part.type === "code") {
          return <CodeBlock key={pIdx} code={part.code} language={part.language} />;
        }
        return <ProseRenderer key={pIdx} text={part.text} />;
      })}
    </div>
  );
};

const ProseRenderer: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split(/\r?\n/);

  return (
    <div className="space-y-1">
      {lines.map((line, lIdx) => {
        if (!line.trim()) {
          return <div key={lIdx} className="h-2" />;
        }

        // Blockquote: > text
        if (line.startsWith("> ")) {
          return (
            <blockquote
              key={lIdx}
              className="border-l-4 border-[#00a884] pl-3 py-0.5 text-[#8696a0] italic"
            >
              {renderFormattedInline(line.slice(2))}
            </blockquote>
          );
        }

        // Bullet list: - item
        if (line.startsWith("- ")) {
          return (
            <div key={lIdx} className="flex items-start gap-2 pl-2">
              <span className="text-[#00a884] font-bold">•</span>
              <span>{renderFormattedInline(line.slice(2))}</span>
            </div>
          );
        }

        // Numbered list: 1. item
        const numMatch = line.match(/^(\d+)\.\s+(.*)/);
        if (numMatch) {
          return (
            <div key={lIdx} className="flex items-start gap-2 pl-2">
              <span className="text-[#8696a0] font-mono text-xs">{numMatch[1]}.</span>
              <span>{renderFormattedInline(numMatch[2])}</span>
            </div>
          );
        }

        // Regular prose line
        return <p key={lIdx}>{renderFormattedInline(line)}</p>;
      })}
    </div>
  );
};

function renderFormattedInline(text: string): React.ReactNode[] {
  // Regex to match inline tokens:
  // inline code `...`, bold *...*, italic _..._, strikethrough ~...~, mention @..., url http...
  const tokenRegex = /(`[^`]+`|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|@[a-zA-Z0-9_.-]+|https?:\/\/[^\s]+)/g;

  const elements: React.ReactNode[] = [];
  let lastIdx = 0;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      elements.push(text.slice(lastIdx, match.index));
    }

    const tok = match[0];
    if (tok.startsWith("`") && tok.endsWith("`")) {
      elements.push(
        <code
          key={match.index}
          className="px-1.5 py-0.5 rounded bg-[#202c33] text-[#00a884] font-mono text-xs border border-[#2a3942]"
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("*") && tok.endsWith("*")) {
      elements.push(
        <strong key={match.index} className="font-bold text-white">
          {tok.slice(1, -1)}
        </strong>
      );
    } else if (tok.startsWith("_") && tok.endsWith("_")) {
      elements.push(
        <em key={match.index} className="italic text-[#d1d7db]">
          {tok.slice(1, -1)}
        </em>
      );
    } else if (tok.startsWith("~") && tok.endsWith("~")) {
      elements.push(
        <del key={match.index} className="line-through text-[#8696a0]">
          {tok.slice(1, -1)}
        </del>
      );
    } else if (tok.startsWith("@")) {
      const isChannel = tok === "@channel";
      elements.push(
        <span
          key={match.index}
          className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
            isChannel
              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
              : "bg-[#00a884]/20 text-[#00a884] border border-[#00a884]/30"
          }`}
        >
          {tok}
        </span>
      );
    } else if (tok.startsWith("http://") || tok.startsWith("https://")) {
      elements.push(
        <a
          key={match.index}
          href={tok}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#58a6ff] hover:underline"
        >
          {tok}
        </a>
      );
    } else {
      elements.push(tok);
    }

    lastIdx = match.index + tok.length;
  }

  if (lastIdx < text.length) {
    elements.push(text.slice(lastIdx));
  }

  return elements;
}
