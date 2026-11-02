import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EL Smart Tracker", short_name: "EL Tracker", description: "Track EMIs, loans and borrowings, and clear them sooner.",
    start_url: "/", display: "standalone", background_color: "#f6f7fb", theme_color: "#4f46e5",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }, { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}
