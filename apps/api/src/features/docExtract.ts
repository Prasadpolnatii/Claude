import { badRequest } from "../middleware/error.js";

/**
 * Extract plain text from an uploaded runbook. Supports PDF (via unpdf) and
 * plain text / Markdown. Returns the document text; the caller chunks + embeds.
 */

const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/octet-stream", // many clients send .md/.txt as octet-stream
]);

export async function extractText(file: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}): Promise<string> {
  const name = file.originalname.toLowerCase();
  const isPdf = file.mimetype === "application/pdf" || name.endsWith(".pdf");

  if (isPdf) {
    // unpdf is ESM-native and serverless-friendly (no worker/file-system deps).
    const { extractText: pdfExtract, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
    const { text } = await pdfExtract(pdf, { mergePages: true });
    return (Array.isArray(text) ? text.join("\n") : text).trim();
  }

  if (TEXT_TYPES.has(file.mimetype) || name.endsWith(".txt") || name.endsWith(".md")) {
    return file.buffer.toString("utf8").trim();
  }

  throw badRequest(`unsupported file type: ${file.mimetype || file.originalname}. Upload PDF, .txt, or .md.`);
}
