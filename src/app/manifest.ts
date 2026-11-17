import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SokoSoo", short_name: "SokoSoo",
    description: "Your local farm-to-consumer marketplace",
    start_url: "/", display: "standalone", background_color: "#ffffff", theme_color: "#5c7952",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
