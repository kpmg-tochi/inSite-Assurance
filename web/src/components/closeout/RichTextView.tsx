import React from "react";
import { parseHandoverRichText, type RichSpan } from "@insite/shared";

/**
 * Renders stakeholder text with the small formatting allow-list (paragraphs, lists, bold,
 * italics). Text is always rendered as React text nodes: never innerHTML.
 */
function Spans({ spans }: { spans: RichSpan[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.bold ? <strong key={i}>{s.text}</strong> : s.italic ? <em key={i}>{s.text}</em> : <React.Fragment key={i}>{s.text}</React.Fragment>
      )}
    </>
  );
}

export function RichTextView({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseHandoverRichText(text);
  if (blocks.length === 0) return <p className={`text-xs italic text-slate-400 ${className}`}>No comments.</p>;
  return (
    <div className={`space-y-2 text-xs leading-relaxed text-slate-700 ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === "paragraph") {
          return (
            <p key={i}>
              {b.lines.map((line, j) => (
                <React.Fragment key={j}>
                  {j > 0 && <br />}
                  <Spans spans={line} />
                </React.Fragment>
              ))}
            </p>
          );
        }
        const items = b.items.map((item, j) => (
          <li key={j}>
            <Spans spans={item} />
          </li>
        ));
        return b.type === "bullets" ? (
          <ul key={i} className="list-disc pl-5 space-y-0.5">
            {items}
          </ul>
        ) : (
          <ol key={i} className="list-decimal pl-5 space-y-0.5">
            {items}
          </ol>
        );
      })}
    </div>
  );
}
