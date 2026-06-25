import { redirect } from "next/navigation";

// The app root sends unauthenticated visitors to the login page.
export default function RootPage() {
  redirect("/login");
}
