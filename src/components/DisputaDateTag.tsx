import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import { getDisputaDateTag } from "../utils/disputaDates";

// Badge chamativo do calendário inteligente: vermelho para hoje (mais urgente),
// âmbar para amanhã.
export default function DisputaDateTag({ value, className = "" }: { value: string; className?: string }) {
  const tag = getDisputaDateTag(value);
  if (!tag) return null;
  return (
    <Badge
      className={cn(
        "border-0 font-bold",
        tag.tone === "today" ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground",
        className
      )}
    >
      {tag.label}
    </Badge>
  );
}
