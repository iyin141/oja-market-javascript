import { DashboardLayout } from "@/components/DashboardLayout";

const NAV: [string, string, string][] = [["/admin", "Overview", "dashboard"], ["/admin/vendors", "Vendors", "storefront"], ["/admin/disputes", "Disputes", "gavel"]];
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayout title="Admin" nav={NAV}>{children}</DashboardLayout>;
}
