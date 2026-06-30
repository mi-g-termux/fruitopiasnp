export class jsPDF {
  constructor(_opts?: unknown) {}
  setFontSize(_s: number) { return this; }
  setFont(_name: string, _style?: string) { return this; }
  setTextColor(..._args: unknown[]) { return this; }
  setFillColor(..._args: unknown[]) { return this; }
  setDrawColor(..._args: unknown[]) { return this; }
  setLineWidth(_w: number) { return this; }
  text(_text: string | string[], _x: number, _y: number, _opts?: unknown) { return this; }
  line(_x1: number, _y1: number, _x2: number, _y2: number) { return this; }
  rect(_x: number, _y: number, _w: number, _h: number, _style?: string) { return this; }
  roundedRect(_x: number, _y: number, _w: number, _h: number, _rx: number, _ry: number, _style?: string) { return this; }
  addPage() { return this; }
  splitTextToSize(text: string, _maxWidth: number): string[] { return [text]; }
  getTextWidth(_text: string) { return 0; }
  getStringUnitWidth(_text: string) { return 0; }
  internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
  output(_type: string) { return ''; }
  outputAsDataURIstring() { return ''; }
  save(_filename: string) {}
}
export default jsPDF;
