import { redirect } from "next/navigation";

/** The settings root has no content of its own; departments is the first thing an owner needs. */
export default function HrSettingsIndexPage() {
  redirect("/app/hr/settings/departments");
}
