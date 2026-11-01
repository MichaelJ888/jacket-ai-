"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Sub-pages that carry published visual-editor content. Other routes never load the CMS script.
const CMS_PAGES = ["/production-workflow", "/capabilities", "/advantages"];

export default function CmsLoader() {
  const pathname = usePathname();

  useEffect(() => {
    const editing = new URLSearchParams(window.location.search).get("cms") === "editor";
    if (!editing && !CMS_PAGES.includes(pathname)) return;
    if (document.querySelector("script[data-cms-loader]")) return;
    const script = document.createElement("script");
    script.src = "/site-cms.js";
    script.defer = true;
    script.dataset.cmsLoader = "";
    document.body.appendChild(script);
  }, [pathname]);

  return null;
}
