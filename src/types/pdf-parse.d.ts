declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
  }

  export default function pdfParse(buffer: Uint8Array): Promise<PdfParseResult>;
}

declare module "pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js" {
  export const VERBOSITY_LEVELS: {
    errors: number;
  };

  export function setVerbosityLevel(level: number): void;
}
