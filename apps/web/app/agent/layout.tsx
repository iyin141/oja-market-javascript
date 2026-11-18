import { RoleGuard } from "@/components/RoleGuard";
import { Shell } from "@/components/Shell";

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard roles={["AGENT", "ADMIN"]}><Shell wide={false}>{children}</Shell></RoleGuard>;
}
