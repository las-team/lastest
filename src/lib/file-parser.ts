import { extractText } from 'unpdf';

export async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'pdf') {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const { text } = await extractText(buffer);
    return text.join('\n');
  }

  // .md, .txt, and other text files
  return await file.text();
}
