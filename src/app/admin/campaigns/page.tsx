import { redirect } from "next/navigation";

// Campaigns now live on the Nurture page. Old links and bookmarks still work.
export default function CampaignsRedirect() {
  redirect("/admin/nurture?view=campaigns");
}
