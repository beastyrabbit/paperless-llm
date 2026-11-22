import type { Child } from "hono/jsx";
import type { ReviewData, StripData } from "../model.js";
import { Strip } from "./activity.js";
import { Counts, type Shell } from "./layout.js";
import { ReviewSummary } from "./review.js";

export function ResponseFragments({
  children,
  shell,
  review,
  strip,
  message,
}: {
  children: Child;
  shell: Shell;
  review?: ReviewData;
  strip?: StripData;
  message: string;
}) {
  return (
    <>
      {children}
      <Counts counts={shell.counts} oob />
      {review && <ReviewSummary data={review} oob />}
      <div id="announce" class="vh" role="status" aria-live="polite" hx-swap-oob="true">
        {message}
      </div>
      {strip && <Strip data={strip} oob />}
    </>
  );
}
