import { legalResponse } from "@/lib/legal/render";

export const dynamic = "force-static";

export function GET() {
  return legalResponse("de", "notice");
}
