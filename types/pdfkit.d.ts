// Type declarations for pdfkit (no @types/pdfkit available)
// Minimal declaration covering the API surface used by GCCLAB.
declare module "pdfkit" {
  import type { Writable } from "stream";

  interface PDFDocumentOptions {
    size?: string | [number, number];
    margin?: number;
    [key: string]: unknown;
  }

  interface TextOptions {
    align?: "left" | "center" | "right" | "justify";
    width?: number;
    height?: number;
    continued?: boolean;
    ellipsis?: boolean | string;
    underline?: boolean;
    lineBreak?: boolean;
    [key: string]: unknown;
  }

  class PDFDocument extends Writable {
    constructor(options?: PDFDocumentOptions);

    fontSize(size: number): this;
    font(name: string): this;
    fillColor(color: string): this;
    fillColor(r: number, g: number, b: number): this;
    fillColor(r: number, g: number, b: number, a: number): this;
    strokeColor(color: string): this;
    strokeColor(r: number, g: number, b: number): this;
    strokeColor(r: number, g: number, b: number, a: number): this;
    registerFont(name: string, path: string): this;

    text(text: string, options?: TextOptions): this;
    text(text: string, x: number, y: number, options?: TextOptions): this;

    moveDown(lines?: number): this;

    rect(x: number, y: number, w: number, h: number): this;
    roundedRect(x: number, y: number, w: number, h: number, r: number): this;
    lineCap(style: string): this;
    lineWidth(w: number): this;
    dash(length: number, options?: unknown): this;
    undash(): this;
    stroke(): this;
    stroke(color: string): this;
    fill(): this;
    fill(color: string): this;
    fillAndStroke(fillColor: string, strokeColor: string): this;

    circle(x: number, y: number, radius: number): this;
    ellipse(x: number, y: number, rx: number, ry: number): this;
    polygon(...points: Array<[number, number]>): this;

    save(): this;
    restore(): this;
    translate(x: number, y: number): this;
    rotate(angle: number, options?: unknown): this;
    scale(factor: number): this;
    opacity(value: number): this;

    // Path methods
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): this;
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): this;
    closePath(): this;

    image(path: string, x?: number, y?: number, options?: unknown): this;
    image(buffer: Buffer, x?: number, y?: number, options?: unknown): this;

    addPage(options?: PDFDocumentOptions): this;
    switchToPage(n: number): this;
    bufferedPageRange(): { start: number; count: number };

    on(event: "data", listener: (chunk: Buffer) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;

    end(): void;

    // Properties
    y: number;
    x: number;
    page: {
      width: number;
      height: number;
      margins: { top: number; bottom: number; left: number; right: number };
    };
    heightOfString(text: string, options?: TextOptions): number;
    widthOfString(text: string, options?: TextOptions): number;
  }

  export = PDFDocument;
}
