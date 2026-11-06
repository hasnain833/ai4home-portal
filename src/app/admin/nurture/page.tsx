import { Suspense } from "react";
import NurtureShell from "./NurtureShell";

export default function NurturePage() {
  return (
    <Suspense>
      <NurtureShell />
    </Suspense>
  );
}
