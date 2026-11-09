const SPLIT_LINE_REGEX = /^--! split: ([0-9]+(?:-[-_a-zA-Z0-9]+)?\.sql)$/gm;

export interface SqlSourceSegment {
  start: number;
  end: number;
  filename: string;
}

export interface ResolvedSqlPosition {
  filename: string;
  line: number;
  column: number;
  /** 0-based offset into `body` */
  position0: number;
  segment: SqlSourceSegment;
}

export function buildSplitSourceSegments(
  body: string,
  options: { defaultFilename: string; splitBasePath?: string },
): SqlSourceSegment[] {
  const segments: SqlSourceSegment[] = [];
  let currentFilename = options.defaultFilename;
  let contentStart = 0;

  const splitPoints: Array<{ index: number; splitEnd: number; file: string }> =
    [];
  for (const match of body.matchAll(SPLIT_LINE_REGEX)) {
    const index = match.index;
    if (index === undefined) {
      continue;
    }
    splitPoints.push({
      index,
      splitEnd: index + match[0].length,
      file: match[1],
    });
  }

  if (splitPoints.length === 0) {
    return [{ start: 0, end: body.length, filename: currentFilename }];
  }

  for (const sp of splitPoints) {
    if (sp.index > contentStart) {
      segments.push({
        start: contentStart,
        end: sp.index,
        filename: currentFilename,
      });
    }
    let nextStart = sp.splitEnd;
    if (body[nextStart] === "\n") {
      nextStart++;
    }
    currentFilename = options.splitBasePath
      ? `${options.splitBasePath}/${sp.file}`
      : sp.file;
    contentStart = nextStart;
  }

  if (contentStart < body.length) {
    segments.push({
      start: contentStart,
      end: body.length,
      filename: currentFilename,
    });
  }

  return segments;
}

export function resolveSqlPosition(
  body: string,
  position1Based: number,
  options: { defaultFilename: string; splitBasePath?: string },
): ResolvedSqlPosition {
  const position0 = position1Based - 1;
  const segments = buildSplitSourceSegments(body, options);
  const segment =
    segments.find((s) => position0 >= s.start && position0 < s.end) ??
    segments[segments.length - 1];

  let line = 1;
  let column = 0;
  for (let idx = segment.start; idx <= position0 && idx < segment.end; idx++) {
    column++;
    if (body[idx] === "\n") {
      line++;
      column = 0;
    }
  }

  return {
    filename: segment.filename,
    line,
    column,
    position0,
    segment,
  };
}
