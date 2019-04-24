export default function indent(text: string, spaces: number): string;
export default function indent(text: string, indentString: string): string;
export default function indent(
  text: string,
  indentStringOrSpaces: number | string
): string {
  const indentString =
    typeof indentStringOrSpaces === "string"
      ? indentStringOrSpaces
      : " ".repeat(indentStringOrSpaces);
  return indentString + text.replace(/\n(?!$)/g, "\n" + indentString);
}
