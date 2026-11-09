import { DashboardLayout } from "@/components/DashboardLayout";

const NAV: [string, string, string][] = [
  ["/seller", "Dashboard", "dashboard"], ["/seller/products", "Products", "inventory_2"], ["/seller/orders", "Orders", "receipt_long"],
  ["/seller/payouts", "Payouts", "account_balance_wallet"], ["/seller/onboarding", "Verification", "verified_user"],
];
export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayout title="Seller centre" nav={NAV}>{children}</DashboardLayout>;
}
