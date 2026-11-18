import { DashboardLayout } from "@/components/DashboardLayout";
import { RoleGuard } from "@/components/RoleGuard";

const NAV: [string, string, string][] = [
  ["/admin", "Overview", "dashboard"], ["/admin/vendors", "Vendors", "storefront"], ["/admin/products", "Product review", "fact_check"],
  ["/admin/disputes", "Disputes", "gavel"], ["/admin/analytics", "Analytics", "monitoring"], ["/admin/tools", "Tools", "tune"],
];
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard roles={["ADMIN"]}><DashboardLayout title="Admin" nav={NAV}>{children}</DashboardLayout></RoleGuard>;
}
