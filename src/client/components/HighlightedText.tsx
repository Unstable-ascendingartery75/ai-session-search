import { Fragment } from "react";
import { splitTextByLiteralQuery } from "../textHighlight.ts";

export const HighlightedText = ({ text, query }: { text: string; query: string }) =>
  splitTextByLiteralQuery(text, query).map((part, index) =>
    part.highlighted ? (
      <mark className="search-highlight" key={index}>{part.value}</mark>
    ) : (
      <Fragment key={index}>{part.value}</Fragment>
    ),
  );
