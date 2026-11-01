import React, { useState, useMemo } from "react";
import { Check, Copy, ChevronDown, ChevronUp, AlignLeft, WrapText } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
}

// Token types for regex-based highlighter
interface Token {
  type: "keyword" | "string" | "comment" | "number" | "function" | "type" | "text";
  text: string;
}

const KEYWORDS = new Set([
  "def", "class", "return", "import", "from", "as", "if", "elif", "else",
  "for", "while", "break", "continue", "try", "except", "finally", "with",
  "async", "await", "lambda", "yield", "pass", "in", "is", "not", "and", "or",
  "const", "let", "var", "function", "export", "default", "interface", "type",
  "select", "insert", "update", "delete", "where", "from", "join", "group", "by",
  "fn", "pub", "impl", "struct", "enum", "mut", "match", "package", "go",
]);

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let remaining = line;

  // Simple tokenizer
  while (remaining.length > 0) {
    // Comment
    const commentMatch = remaining.match(/^(\/\/.*|#.*|\/\*.*\*\/)/);
    if (commentMatch) {
      tokens.push({ type: "comment", text: commentMatch[0] });
      remaining = remaining.slice(commentMatch[0].length);
      continue;
    }

    // String
    const strMatch = remaining.match(/^("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|`[^`\\]*(?:\\.[^`\\]*)*`)/);
    if (strMatch) {
      tokens.push({ type: "string", text: strMatch[0] });
      remaining = remaining.slice(strMatch[0].length);
      continue;
    }

    // Number
    const numMatch = remaining.match(/^(\b\d+(?:\.\d+)?\b)/);
    if (numMatch) {
      tokens.push({ type: "number", text: numMatch[0] });
      remaining = remaining.slice(numMatch[0].length);
      continue;
    }

    // Word (keyword, function, type, text)
    const wordMatch = remaining.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (wordMatch) {
      const word = wordMatch[0];
      if (KEYWORDS.has(word.toLowerCase())) {
        tokens.push({ type: "keyword", text: word });
      } else if (remaining.slice(word.length).trim().startsWith("(")) {
        tokens.push({ type: "function", text: word });
      } else if (/^[A-Z]/.test(word)) {
        tokens.push({ type: "type", text: word });
      } else {
        tokens.push({ type: "text", text: word });
      }
      remaining = remaining.slice(word.length);
      continue;
    }

    // Other symbols / whitespace
    const otherMatch = remaining.match(/^([^\w"'`#/]+|\s+)/);
    if (otherMatch) {
      tokens.push({ type: "text", text: otherMatch[0] });
      remaining = remaining.slice(otherMatch[0].length);
      continue;
    }

    // Fallback one char
    tokens.push({ type: "text", text: remaining[0] });
    remaining = remaining.slice(1);
  }

  return tokens;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language = "plaintext" }) => {
  const [copied, setCopied] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [wrapLines, setWrapLines] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const lines = useMemo(() => code.split(/\r?\n/), [code]);
  const isCollapsible = lines.length > 20;
  const displayedLines = isCollapsible && !isExpanded ? lines.slice(0, 12) : lines;

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2 rounded-xl bg-[#0d1117] border border-[#30363d] overflow-hidden text-xs font-mono shadow-md">
      {/* Code Header Toolbar */}
      <div className="px-3 py-1.5 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between text-[#8b949e] select-none">
        <span className="font-semibold uppercase tracking-wider text-[11px] text-[#58a6ff]">
          {language || "code"}
        </span>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setWrapLines(!wrapLines)}
            title={wrapLines ? "Disable wrap" : "Enable wrap"}
            className="p-1 hover:text-white hover:bg-[#21262d] rounded transition"
          >
            <WrapText className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            title={showLineNumbers ? "Hide line numbers" : "Show line numbers"}
            className="p-1 hover:text-white hover:bg-[#21262d] rounded transition"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleCopy}
            className="px-2 py-0.5 hover:text-white hover:bg-[#21262d] rounded flex items-center gap-1 transition"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[10px] text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="text-[10px]">Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code Content */}
      <div className={`p-3 overflow-x-auto ${wrapLines ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}>
        <table className="w-full border-collapse">
          <tbody>
            {displayedLines.map((line, idx) => {
              const tokens = tokenizeLine(line);
              return (
                <tr key={idx} className="leading-relaxed hover:bg-[#161b22]/50">
                  {showLineNumbers && (
                    <td className="w-10 pr-4 text-right text-[#484f58] select-none align-top">
                      {idx + 1}
                    </td>
                  )}
                  <td className="align-top text-[#c9d1d9]">
                    {tokens.map((tok, tIdx) => {
                      if (tok.type === "keyword") {
                        return <span key={tIdx} className="text-[#ff7b72] font-semibold">{tok.text}</span>;
                      } else if (tok.type === "string") {
                        return <span key={tIdx} className="text-[#a5d6ff]">{tok.text}</span>;
                      } else if (tok.type === "comment") {
                        return <span key={tIdx} className="text-[#8b949e] italic">{tok.text}</span>;
                      } else if (tok.type === "number") {
                        return <span key={tIdx} className="text-[#79c0ff]">{tok.text}</span>;
                      } else if (tok.type === "function") {
                        return <span key={tIdx} className="text-[#d2a8ff]">{tok.text}</span>;
                      } else if (tok.type === "type") {
                        return <span key={tIdx} className="text-[#ffa657]">{tok.text}</span>;
                      }
                      return <span key={tIdx}>{tok.text}</span>;
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Collapsed expander button */}
      {isCollapsible && (
        <div className="px-3 py-1.5 bg-[#161b22] border-t border-[#30363d] text-center">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-[11px] font-semibold text-[#58a6ff] hover:underline flex items-center justify-center gap-1 mx-auto"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Show less</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Show all {lines.length} lines</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
