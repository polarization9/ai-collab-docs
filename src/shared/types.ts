export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type Heading = {
  id: string;
  level: HeadingLevel;
  text: string;
};

export type ReviewDocument = {
  id: string;
  absolutePath: string;
  relativePath: string;
  reviewPath: string;
  content: string;
  headings: Heading[];
};

export type ApiError = {
  error: string;
};
