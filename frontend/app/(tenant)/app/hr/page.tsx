import { redirect } from "next/navigation";

// HR root redirects to the Employees sub-page (the natural entry point).
export default function HrPage() {
  redirect("/app/hr/employees");
}
