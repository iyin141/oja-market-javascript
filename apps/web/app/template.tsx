import { RouteBar } from "@/components/RouteBar";

export default function Template({ children }: { children: React.ReactNode }) {
  return (<><RouteBar /><div className="page-in">{children}</div></>);
}
