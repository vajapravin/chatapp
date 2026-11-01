import React, { useState, useRef } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  FileCode,
  Quote,
  List,
  Eye,
  Send,
} from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface PostComposerProps {
  channelName: string;
  onSendPost: (content: string) => Promise<void>;
  disabled?: boolean;
}

export const PostComposer: React.FC<PostComposerProps> = ({
  channelName,
  onSendPost,
  disabled = false,
}) => {
  const [content, setContent] = useState("");
  const [isPreview, setIsPreview] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const applyFormatting = (prefix: string, suffix: string = prefix, defaultPlaceholder: string = "text") => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.slice(start, end) || defaultPlaceholder;

    const updated = content.slice(0, start) + prefix + selected + suffix + content.slice(end);
    setContent(updated);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Shift+C -> wrap in code block
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      applyFormatting("```\n", "\n```", "code here");
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      // Check if cursor is inside open code fence
      const beforeCursor = content.slice(0, e.currentTarget.selectionStart);
      const codeFenceCount = (beforeCursor.match(/```/g) || []).length;
      const isInsideCodeFence = codeFenceCount % 2 === 1;

      if (!isInsideCodeFence) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  const handleSend = async () => {
    const trimmed = content.trim();
    if (!trimmed || isSending || disabled) return;

    setIsSending(true);
    try {
      await onSendPost(trimmed);
      setContent("");
      setIsPreview(false);
    } catch (err) {
      console.error("Failed to send post:", err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="p-4 bg-[#111b21] border-t border-[#202c33] shrink-0">
      <div className="rounded-2xl bg-[#202c33] border border-[#2a3942] overflow-hidden focus-within:border-[#00a884] transition shadow-md">
        {/* Formatting Toolbar */}
        <div className="px-3 py-1.5 bg-[#182229] border-b border-[#2a3942]/70 flex items-center justify-between text-[#8696a0] select-none">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => applyFormatting("*", "*", "bold text")}
              title="Bold (*text*)"
              className="p-1 hover:text-white hover:bg-[#202c33] rounded transition"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting("_", "_", "italic text")}
              title="Italic (_text_)"
              className="p-1 hover:text-white hover:bg-[#202c33] rounded transition"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting("~", "~", "strikethrough")}
              title="Strikethrough (~text~)"
              className="p-1 hover:text-white hover:bg-[#202c33] rounded transition"
            >
              <Strikethrough className="w-3.5 h-3.5" />
            </button>
            <span className="w-px h-3.5 bg-[#2a3942] mx-1" />
            <button
              type="button"
              onClick={() => applyFormatting("`", "`", "code")}
              title="Inline Code (`code`)"
              className="p-1 hover:text-white hover:bg-[#202c33] rounded transition"
            >
              <Code className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting("```\n", "\n```", "code here")}
              title="Code Block (Ctrl+Shift+C)"
              className="p-1 hover:text-white hover:bg-[#202c33] rounded transition"
            >
              <FileCode className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting("> ", "", "quote")}
              title="Blockquote (> quote)"
              className="p-1 hover:text-white hover:bg-[#202c33] rounded transition"
            >
              <Quote className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting("- ", "", "item")}
              title="Bulleted List (- item)"
              className="p-1 hover:text-white hover:bg-[#202c33] rounded transition"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsPreview(!isPreview)}
            title="Toggle Markdown Preview"
            className={`px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1 transition ${
              isPreview
                ? "bg-[#00a884] text-[#111b21]"
                : "text-[#8696a0] hover:text-white hover:bg-[#202c33]"
            }`}
          >
            <Eye className="w-3 h-3" />
            <span>Preview</span>
          </button>
        </div>

        {/* Editor or Preview Pane */}
        {isPreview ? (
          <div className="p-3.5 min-h-[72px] max-h-48 overflow-y-auto bg-[#111b21]/40">
            {content.trim() ? (
              <MarkdownRenderer content={content} />
            ) : (
              <span className="text-xs text-[#8696a0] italic">Nothing to preview</span>
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            rows={2}
            value={content}
            disabled={disabled}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message #${channelName}... (Shift+Enter for newline, Enter to send)`}
            className="w-full px-3.5 py-2.5 bg-transparent text-sm text-[#e9edef] placeholder-[#8696a0] focus:outline-none resize-none max-h-48"
          />
        )}

        {/* Footer actions */}
        <div className="px-3 py-1.5 bg-[#182229]/60 flex items-center justify-between">
          <span className="text-[10px] text-[#8696a0]">
            Use <code className="text-[#00a884]">@channel</code> for announcements
          </span>

          <button
            type="button"
            onClick={handleSend}
            disabled={!content.trim() || isSending || disabled}
            className="px-3 py-1 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl font-bold text-xs flex items-center gap-1.5 transition disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </div>
      </div>
    </div>
  );
};
