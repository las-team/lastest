import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ReactMarkdown from 'react-markdown';

type LegalSlug = 'terms' | 'privacy' | 'cookies' | 'dpa';

interface LegalDocProps {
  slug: LegalSlug;
  title: string;
  version: string;
}

export async function LegalDoc({ slug, title, version }: LegalDocProps) {
  const filePath = path.join(process.cwd(), 'src/content/legal', `${slug}.md`);
  const content = await readFile(filePath, 'utf8');

  return (
    <article className="prose prose-neutral dark:prose-invert max-w-none">
      <h1>{title}</h1>
      <p className="text-sm text-muted-foreground">Last updated: {version}</p>
      <ReactMarkdown>{content}</ReactMarkdown>
    </article>
  );
}
