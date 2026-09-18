import { type ReactNode } from 'react';

import { type Block, type Inline, guideLinkTarget, parseMarkdown } from './markdown';

interface Props {
  readonly markdown: string;
  /** Called for links to other guide pages; other links open in a new tab. */
  readonly onNavigate: (pageId: string) => void;
}

function renderInlines(inlines: readonly Inline[], onNavigate: Props['onNavigate']): ReactNode[] {
  return inlines.map((node, i) => {
    switch (node.kind) {
      case 'text':
        return node.text;
      case 'code':
        return <code key={i}>{node.text}</code>;
      case 'strong':
        return <strong key={i}>{renderInlines(node.children, onNavigate)}</strong>;
      case 'em':
        return <em key={i}>{renderInlines(node.children, onNavigate)}</em>;
      case 'link': {
        const page = guideLinkTarget(node.href);
        if (page !== null) {
          return (
            <button
              key={i}
              type="button"
              className="help__page-link"
              onClick={() => {
                onNavigate(page);
              }}
            >
              {renderInlines(node.children, onNavigate)}
            </button>
          );
        }
        return (
          <a key={i} href={node.href} target="_blank" rel="noreferrer">
            {renderInlines(node.children, onNavigate)}
          </a>
        );
      }
    }
  });
}

function renderBlock(block: Block, key: number, onNavigate: Props['onNavigate']): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const content = renderInlines(block.children, onNavigate);
      // The page title is an h2 (the dialog's title is the h1 of the help), sections h3/h4.
      if (block.level === 1) return <h2 key={key}>{content}</h2>;
      if (block.level === 2) return <h3 key={key}>{content}</h3>;
      return <h4 key={key}>{content}</h4>;
    }
    case 'paragraph':
      return <p key={key}>{renderInlines(block.children, onNavigate)}</p>;
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i}>{renderInlines(item, onNavigate)}</li>
      ));
      return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case 'code':
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
    case 'table':
      return (
        <table key={key}>
          <thead>
            <tr>
              {block.header.map((cell, i) => (
                <th key={i}>{renderInlines(cell, onNavigate)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{renderInlines(cell, onNavigate)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

/** Renders guide Markdown (see `markdown.ts` for the supported subset). */
export function Markdown({ markdown, onNavigate }: Props) {
  return <>{parseMarkdown(markdown).map((b, i) => renderBlock(b, i, onNavigate))}</>;
}
