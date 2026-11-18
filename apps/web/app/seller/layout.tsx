import { DashboardLayout } from "@/components/DashboardLayout";
import { RoleGuard } from "@/components/RoleGuard";

const NAV: [string, string, string][] = [
  ["/seller", "Dashboard", "dashboard"], ["/seller/products", "Products", "inventory_2"], ["/seller/orders", "Orders", "receipt_long"],
  ["/seller/returns", "Returns", "assignment_return"], ["/seller/payouts", "Payouts", "account_balance_wallet"], ["/seller/onboarding", "Verification", "verified_user"],
];
export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard roles={["VENDOR"]}><DashboardLayout title="Seller centre" nav={NAV}>{children}</DashboardLayout></RoleGuard>;
}
