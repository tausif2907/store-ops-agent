import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders the agent's markdown answers (lists, tables, emphasis). No raw HTML. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-agent space-y-2 text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
