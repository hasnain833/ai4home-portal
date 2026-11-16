import { redirect } from "next/navigation";

// News now lives on the Content page; old links and emails still land there.
export default function AdminNewsRedirect() {
  redirect("/admin/content?kind=NEWS");
}
